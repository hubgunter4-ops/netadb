package expo.modules.netadb

import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.app.AppOpsManager
import android.app.usage.NetworkStatsManager
import android.net.ConnectivityManager
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.IBinder
import android.os.Process as AndroidProcess
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.BufferedWriter
import java.io.File
import java.lang.Process as JavaProcess
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class NetadbBridgeModule : Module() {
  private var logcatProcess: JavaProcess? = null
  private var logcatThread: Thread? = null
  private val shellLock = Any()
  private var shellProcess: JavaProcess? = null
  private var shellInput: BufferedWriter? = null
  private var shellThread: Thread? = null
  private var shellSerial: String? = null

  override fun definition() = ModuleDefinition {
    Name("NetadbBridge")
    Events("onLogLine", "onShellLine", "onShellState")

    AsyncFunction("isAvailable") {
      val app = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val adb = File(app.applicationInfo.nativeLibraryDir, "libadb.so")
      mapOf(
        "available" to (adb.canExecute() && runCatching { runAdb(adb.absolutePath, listOf("version"), 10).exitCode == 0 }.getOrDefault(false)),
        "androidVersion" to android.os.Build.VERSION.RELEASE,
        "apiLevel" to android.os.Build.VERSION.SDK_INT
      )
    }

    AsyncFunction("getShizukuStatus") {
      val running = runCatching { Shizuku.pingBinder() }.getOrDefault(false)
      val uid = if (running) runCatching { Shizuku.getUid() }.getOrDefault(-1) else -1
      val granted = running && uid == 2000 && runCatching {
        Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
      }.getOrDefault(false)
      mapOf(
        "serviceRunning" to running,
        "permissionGranted" to granted,
        "uid" to uid,
        "apiVersion" to if (running) runCatching { Shizuku.getVersion() }.getOrDefault(0) else 0
      )
    }

    AsyncFunction("getStandardAndroidStatus") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      mapOf(
        "packageManagerAvailable" to true,
        "usageAccessGranted" to hasUsageAccess(context),
        "usageAccessSettings" to Settings.ACTION_USAGE_ACCESS_SETTINGS,
        "installedPackageCount" to runCatching { context.packageManager.getInstalledApplications(0).size }.getOrDefault(0)
      )
    }

    AsyncFunction("getNetworkSnapshot") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbNetworkInspector.snapshot(context)
    }

    AsyncFunction("getCellularNetworkType") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbNetworkInspector.cellularType(context)
    }

    AsyncFunction("openStandardUsageAccessSettings") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("openDeveloperSettings") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      context.startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("readPairingCodeFromClipboard") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      val text = runCatching {
        if (clipboard?.hasPrimaryClip() == true) {
          clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
        } else {
          ""
        }
      }.getOrDefault("")
      Regex("(?<!\\d)\\d{6}(?!\\d)").find(text)?.value
    }

    AsyncFunction("listStandardPackages") { includeUserApps: Boolean ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      @Suppress("DEPRECATION")
      context.packageManager.getInstalledApplications(0)
        .asSequence()
        .filter { app ->
          val isSystem = (app.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0
          includeUserApps || isSystem
        }
        .filter { it.packageName != context.packageName }
        .map { app ->
          val isSystem = (app.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0
          mapOf(
            "packageName" to app.packageName,
            "kind" to if (isSystem) "system" else "user",
            "disabled" to !app.enabled,
            "protected" to false,
            "label" to context.packageManager.getApplicationLabel(app).toString().take(100)
          )
        }
        .sortedBy { (it["label"] as String).lowercase() }
        .toList()
    }

    AsyncFunction("inspectStandardPackage") { packageName: String ->
      requireValidPackageName(packageName)
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val pm = context.packageManager
      @Suppress("DEPRECATION")
      val info = pm.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS)
      val app = info.applicationInfo ?: throw IllegalStateException("Android no entregó ApplicationInfo")
      val stats = queryStandardNetworkStats(context, app.uid)
      val versionCode = if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
      mapOf(
        "packageName" to packageName,
        "uid" to app.uid,
        "versionCode" to versionCode,
        "versionName" to (info.versionName ?: ""),
        "targetSdk" to app.targetSdkVersion,
        "firstInstallTime" to info.firstInstallTime.toString(),
        "lastUpdateTime" to info.lastUpdateTime.toString(),
        "packageDump" to "PackageManager · permisos solicitados:\n${info.requestedPermissions?.joinToString("\n") ?: "Ninguno"}",
        "appOps" to "Modo estándar: no se consultan AppOps arbitrarios de otros paquetes.",
        "appOpsExitCode" to 0,
        "networkStats" to stats.first,
        "networkStatsAvailable" to stats.second
      )
    }

    AsyncFunction("requestShizukuPermission") {
      require(Shizuku.pingBinder()) { "Inicia Shizuku antes de solicitar permiso" }
      require(Shizuku.getUid() == 2000) { "NetADB solo admite Shizuku en modo ADB/shell (UID 2000), no root/Sui" }
      if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
        Shizuku.requestPermission(24017)
      }
      true
    }

    AsyncFunction("listShizukuPackages") { includeUserApps: Boolean ->
      val json = withShizukuUserService { it.listPackages(includeUserApps) }
      val rows = JSONArray(json)
      (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        mapOf(
          "packageName" to row.getString("packageName"),
          "kind" to row.getString("kind"),
          "disabled" to row.optBoolean("disabled", false),
          "protected" to row.optBoolean("protected", false)
        )
      }
    }

    AsyncFunction("inspectShizukuPackage") { packageName: String ->
      requireValidPackageName(packageName)
      val row = JSONObject(withShizukuUserService { it.inspectPackage(packageName) })
      mapOf(
        "packageName" to row.getString("packageName"),
        "uid" to if (row.isNull("uid")) null else row.getInt("uid"),
        "versionCode" to if (row.isNull("versionCode")) null else row.getLong("versionCode"),
        "versionName" to if (row.isNull("versionName")) null else row.getString("versionName"),
        "targetSdk" to if (row.isNull("targetSdk")) null else row.getInt("targetSdk"),
        "firstInstallTime" to if (row.isNull("firstInstallTime")) null else row.getString("firstInstallTime"),
        "lastUpdateTime" to if (row.isNull("lastUpdateTime")) null else row.getString("lastUpdateTime"),
        "packageDump" to row.optString("packageDump"),
        "appOps" to row.optString("appOps"),
        "appOpsExitCode" to row.optInt("appOpsExitCode", -1),
        "networkStats" to row.optString("networkStats"),
        "networkStatsAvailable" to row.optBoolean("networkStatsAvailable", false)
      )
    }

    AsyncFunction("controlShizukuPackage") { packageName: String, action: String ->
      requireValidPackageName(packageName)
      require(action in setOf("force-stop", "disable-user", "enable")) { "Acción no permitida" }
      val row = JSONObject(withShizukuUserService { it.controlPackage(packageName, action) })
      mapOf(
        "success" to row.optBoolean("success", false),
        "exitCode" to row.optInt("exitCode", -1),
        "output" to row.optString("output")
      )
    }

    AsyncFunction("startDiagnosticsSession") { serial: String, status: String ->
      require(serial.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Identificador de dispositivo inválido" }
      require(status.length <= 120) { "Estado de notificación demasiado largo" }
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      if (!androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        throw IllegalStateException("Activa las notificaciones de NetADB para mantener visible la captura en segundo plano")
      }
      NetadbForegroundService.start(context, serial, status)
      true
    }

    AsyncFunction("updateDiagnosticsSession") { serial: String, status: String, lines: Int ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbForegroundService.update(context, serial, status.take(120), lines.coerceAtLeast(0))
      true
    }

    AsyncFunction("stopDiagnosticsSession") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbForegroundService.stop(context)
      true
    }

    AsyncFunction("getVpnCaptureStatus") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbVpnService.getSnapshot(context)
    }

    AsyncFunction("listVpnTargets") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbVpnService.listTargets(context)
    }

    AsyncFunction("requestVpnConsent") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      check(!NetadbVpnService.hasOtherVpn(context)) {
        "Hay otra VPN activa. Detén esa VPN desde Android antes de autorizar NetADB."
      }
      val request = android.net.VpnService.prepare(context)
      if (request == null) {
        mapOf("permissionGranted" to true, "promptLaunched" to false)
      } else {
        val activity = appContext.currentActivity
          ?: throw IllegalStateException("Vuelve a NetADB en primer plano para mostrar el consentimiento VPN de Android.")
        @Suppress("DEPRECATION")
        activity.runOnUiThread { activity.startActivityForResult(request, 7316) }
        mapOf("permissionGranted" to false, "promptLaunched" to true)
      }
    }

    AsyncFunction("startVpnCapture") { targetPackage: String ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      require(targetPackage.matches(Regex("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+"))) { "Nombre de paquete inválido" }
      check(!NetadbVpnService.hasOtherVpn(context)) {
        "Hay otra VPN activa. Detén esa VPN desde Android antes de iniciar NetADB."
      }
      check(android.net.VpnService.prepare(context) == null) { "Primero autoriza la VPN local en el diálogo de Android." }
      NetadbVpnService.start(context, targetPackage)
      true
    }

    AsyncFunction("stopVpnCapture") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      NetadbVpnService.stop(context)
      true
    }

    AsyncFunction("getLicenses") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val ladb = context.resources.openRawResource(R.raw.ladb_license).bufferedReader().use { it.readText() }
      val adb = context.resources.openRawResource(R.raw.adb_library_license).bufferedReader().use { it.readText() }
      val shizuku = context.resources.openRawResource(R.raw.shizuku_api_license).bufferedReader().use { it.readText() }
      val vpn = context.resources.openRawResource(R.raw.vpn_engine_licenses).bufferedReader().use { it.readText() }
      mapOf("ladb" to ladb, "adb" to adb, "shizuku" to shizuku, "vpn" to vpn)
    }

    AsyncFunction("writeExport") { filename: String, contents: String ->
      require(filename.matches(Regex("[A-Za-z0-9._-]{1,100}"))) { "Nombre de exportación inválido" }
      require(contents.length <= 25_000_000) { "La exportación excede el límite de tamaño" }
      val file = File(appFilesDir(), filename)
      file.writeText(contents, Charsets.UTF_8)
      file.absolutePath
    }

    AsyncFunction("shareFile") { path: String, mimeType: String ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val root = appFilesDir().canonicalPath + File.separator
      val file = File(path).canonicalFile
      require(file.path.startsWith(root) && file.isFile) { "Solo se pueden compartir archivos internos de NetADB" }
      require(mimeType in setOf("application/json", "application/zip", "text/plain", "text/csv")) { "Tipo de archivo no permitido" }
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.netadb.fileprovider", file)
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(Intent.createChooser(intent, "Compartir archivo NetADB").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("deleteDiagnosticFiles") {
      stopLogcatInternal()
      val prefixes = listOf("netadb-logcat-", "netadb-bugreport-", "netadb-session-")
      val files = appFilesDir().listFiles().orEmpty().filter { file ->
        file.isFile && prefixes.any { prefix -> file.name.startsWith(prefix) }
      }
      var bytesDeleted = 0L
      var filesDeleted = 0
      files.forEach { file ->
        val size = file.length()
        if (file.delete()) {
          bytesDeleted += size
          filesDeleted++
        }
      }
      mapOf("filesDeleted" to filesDeleted, "bytesDeleted" to bytesDeleted)
    }

    AsyncFunction("pair") { address: String, pairingCode: String ->
      require(isValidAddress(address)) { "La dirección de emparejamiento debe ser host:puerto" }
      require(pairingCode.matches(Regex("[0-9]{6}"))) { "El código temporal debe tener 6 dígitos" }
      val adb = adbPath()
      val process = adbProcessBuilder(adb, listOf("pair", address.trim())).start()
      val output = StringBuilder()
      val outputLock = Any()
      val outputThread = thread(name = "NetADB-pair-output", isDaemon = true) {
        try {
          process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            lines.forEach { line ->
              synchronized(outputLock) {
                if (output.length < 2_000_000) output.append(line).append('\n')
              }
            }
          }
        } catch (_: Exception) {
          // The reader closes when ADB exits or is stopped on timeout.
        }
      }
      val finished = try {
        process.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
          writer.write(pairingCode)
          writer.newLine()
          writer.flush()
        }
        val completed = waitForProcess(process, 25, TimeUnit.SECONDS)
        if (!completed) terminateProcess(process)
        completed
      } finally {
        if (isProcessAlive(process)) terminateProcess(process)
        outputThread.join(1500)
      }
      val outputText = synchronized(outputLock) { output.toString() }
      mapOf(
        "success" to (finished && process.exitValue() == 0),
        "output" to outputText.ifBlank { if (finished) "ADB pair terminó sin salida" else "Tiempo de emparejamiento agotado" }
      )
    }

    AsyncFunction("pairAutomatically") { pairingCode: String ->
      require(pairingCode.matches(Regex("[0-9]{6}"))) { "El código temporal debe tener 6 dígitos" }
      val endpoints = discoverAdbEndpoints("_adb-tls-pairing._tcp.")
      if (endpoints.isEmpty()) throw IllegalStateException("No se encontró el servicio de pairing. Mantén abierta la pantalla Pair using pairing code y verifica que Wireless debugging esté activo.")
      var last: Map<String, Any>? = null
      for (endpoint in endpoints) {
        val result = pairAtEndpoint(endpoint, pairingCode) + mapOf("address" to endpoint)
        last = result
        val output = result["output"] as? String ?: ""
        if (result["success"] == true || output.contains("authenticate", ignoreCase = true) || output.contains("invalid", ignoreCase = true) || output.contains("code", ignoreCase = true)) break
      }
      last!!
    }

    AsyncFunction("connect") { address: String ->
      require(isValidAddress(address)) { "La dirección de conexión debe ser host:puerto" }
      val adb = adbPath()
      val start = runAdb(adb, listOf("start-server"), 20)
      val targetAddress = address.trim()
      val connection = runAdb(adb, listOf("connect", targetAddress), 20)
      val devicesResult = runAdb(adb, listOf("devices", "-l"), 15)
      val devices = devicesResult.output.lineSequence()
        .map { it.trim().split(Regex("\\s+")) }
        .filter { it.size >= 2 && it[1] == "device" }
        .map { it[0] }
        .toList()
      val targetReady = targetAddress in devices
      mapOf(
        "connected" to targetReady,
        "targetSerial" to if (targetReady) targetAddress else "",
        "devices" to if (targetReady) devices else emptyList<String>(),
        "output" to listOf(start.output, connection.output, devicesResult.output).filter { it.isNotBlank() }.joinToString("\n")
      )
    }

    AsyncFunction("connectAutomatically") {
      val endpoints = discoverAdbEndpoints("_adb-tls-connect._tcp.")
      if (endpoints.isEmpty()) throw IllegalStateException("No se encontró el servicio ADB después del pairing. Activa Wireless debugging y usa la conexión manual si mDNS está bloqueado.")
      var last: Map<String, Any>? = null
      for (endpoint in endpoints) {
        val result = connectAtEndpoint(endpoint) + mapOf("address" to endpoint)
        last = result
        if (result["connected"] == true) break
      }
      last!!
    }

    AsyncFunction("runShell") { serial: String, command: String ->
      require(serial.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Identificador de dispositivo inválido" }
      require(command.isNotBlank() && command.length <= 10000) { "Comando vacío o demasiado largo" }
      val result = runAdb(adbPath(), listOf("-s", serial, "shell", command), 90)
      mapOf("output" to result.output, "exitCode" to result.exitCode)
    }

    AsyncFunction("openShell") { serial: String ->
      require(serial.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Identificador de dispositivo inválido" }
      closeShellInternal(emitClosed = false)
      val process = adbProcessBuilder(adbPath(), listOf("-s", serial, "shell")).start()
      if (waitForProcess(process, 500, TimeUnit.MILLISECONDS)) {
        val output = process.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText().trim() }
        val exitCode = process.exitValue()
        val message = output.ifBlank { "ADB shell terminó al iniciar (código $exitCode)" }
        sendShellState(serial, "error", message = message, exitCode = exitCode)
        return@AsyncFunction mapOf("ready" to false, "serial" to serial, "output" to output)
      }
      if (!isProcessAlive(process)) {
        val output = process.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText().trim() }
        val message = output.ifBlank { "ADB shell dejó de ejecutarse durante el inicio" }
        sendShellState(serial, "error", message = message)
        return@AsyncFunction mapOf("ready" to false, "serial" to serial, "output" to output)
      }
      val input = process.outputStream.bufferedWriter(Charsets.UTF_8)
      synchronized(shellLock) { shellProcess = process; shellInput = input; shellSerial = serial }
      sendShellState(serial, "ready")
      shellThread = thread(name = "NetADB-shell", isDaemon = true) {
        try {
          process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            lines.forEach { line -> sendEvent("onShellLine", mapOf("serial" to serial, "line" to line)) }
          }
          val code = if (waitForProcess(process, 2, TimeUnit.SECONDS)) process.exitValue() else 124
          if (isProcessAlive(process)) terminateProcess(process)
          val stillCurrent = synchronized(shellLock) { shellProcess === process }
          if (stillCurrent) sendShellState(serial, if (code == 0) "closed" else "error", exitCode = code)
        } catch (e: Exception) {
          val stillCurrent = synchronized(shellLock) { shellProcess === process }
          if (stillCurrent && isProcessAlive(process)) sendShellState(serial, "error", message = e.message ?: "Error leyendo shell")
        } finally {
          synchronized(shellLock) {
            if (shellProcess === process) { shellProcess = null; shellInput = null; shellThread = null; shellSerial = null }
          }
        }
      }
      mapOf("ready" to true, "serial" to serial)
    }

    AsyncFunction("sendShellCommand") { command: String ->
      require(command.isNotBlank() && command.length <= 10000 && !command.contains('\u0000')) {
        "Comando vacío, demasiado largo o contiene un byte no permitido"
      }
      synchronized(shellLock) {
        val process = shellProcess ?: return@synchronized false
        val input = shellInput ?: return@synchronized false
        if (!isProcessAlive(process)) return@synchronized false
        runCatching { input.apply { write(command); newLine(); flush() } }.isSuccess
      }
    }

    AsyncFunction("closeShell") { closeShellInternal(); true }

    Function("startLogcat") { serial: String, buffers: List<String> ->
      require(serial.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Identificador de dispositivo inválido" }
      val allowed = setOf("main", "system", "events", "radio", "crash")
      require(buffers.isNotEmpty() && buffers.all { it in allowed }) { "Buffer de logcat no permitido" }
      stopLogcatInternal()
      val args = mutableListOf("-s", serial, "logcat")
      buffers.forEach { args.addAll(listOf("-b", it)) }
      args.addAll(listOf("-v", "threadtime"))
      val process = adbProcessBuilder(adbPath(), args).start()
      val logFile = File(appFilesDir(), "netadb-logcat-${System.currentTimeMillis()}.txt")
      logcatProcess = process
      logcatThread = thread(name = "NetADB-logcat", isDaemon = true) {
        var lineCount = 0
        try {
          logFile.bufferedWriter(Charsets.UTF_8).use { writer ->
            process.inputStream.bufferedReader().useLines { lines ->
              lines.forEach { line ->
                if (Thread.currentThread().isInterrupted) return@forEach
                writer.append(line).append('\n').flush()
                lineCount++
                if (lineCount % 25 == 0) {
                  runCatching { NetadbForegroundService.updateLineCount(lineCount) }
                }
                sendEvent("onLogLine", mapOf("line" to line))
              }
            }
            val exited = waitForProcess(process, 2, TimeUnit.SECONDS)
            if (!exited) terminateProcess(process)
            val exitCode = if (exited || runCatching { waitForProcess(process, 2, TimeUnit.SECONDS) }.getOrDefault(false)) process.exitValue() else 124
            writer.append("\n# NetADB stream ended · exitCode=$exitCode\n").flush()
          }
        } catch (_: Exception) {
          // Stream closure is expected when the user stops logcat.
        }
      }
      logFile.absolutePath
    }

    Function("stopLogcat") {
      stopLogcatInternal()
      true
    }

    AsyncFunction("bugreport") { serial: String ->
      require(serial.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Identificador de dispositivo inválido" }
      val report = File(appFilesDir(), "netadb-bugreport-${System.currentTimeMillis()}.zip")
      val result = runAdb(adbPath(), listOf("-s", serial, "bugreport", report.absolutePath), 240)
      mapOf("output" to result.output, "exitCode" to result.exitCode, "filePath" to if (report.exists()) report.absolutePath else "")
    }

    OnDestroy {
      stopLogcatInternal()
      closeShellInternal()
    }
  }

  private data class CommandResult(val output: String, val exitCode: Int)

  private fun pairAtEndpoint(address: String, pairingCode: String): Map<String, Any> {
    val adb = adbPath()
    val process = adbProcessBuilder(adb, listOf("pair", address)).start()
    val output = StringBuilder()
    val outputLock = Any()
    val outputThread = thread(name = "NetADB-pair-output", isDaemon = true) {
      runCatching {
        process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
          lines.forEach { line -> synchronized(outputLock) { if (output.length < 2_000_000) output.append(line).append('\n') } }
        }
      }
    }
    val finished = try {
      process.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
        writer.write(pairingCode)
        writer.newLine()
        writer.flush()
      }
      val completed = waitForProcess(process, 25, TimeUnit.SECONDS)
      if (!completed) terminateProcess(process)
      completed
    } finally {
      if (isProcessAlive(process)) terminateProcess(process)
      outputThread.join(1500)
    }
    val text = synchronized(outputLock) { output.toString() }
    return mapOf("success" to (finished && process.exitValue() == 0), "output" to text.ifBlank { if (finished) "ADB pair terminó sin salida" else "Tiempo de emparejamiento agotado" })
  }

  private fun connectAtEndpoint(address: String): Map<String, Any> {
    val adb = adbPath()
    val start = runAdb(adb, listOf("start-server"), 20)
    val connection = runAdb(adb, listOf("connect", address), 20)
    val devicesResult = runAdb(adb, listOf("devices", "-l"), 15)
    val devices = devicesResult.output.lineSequence().map { it.trim().split(Regex("\\s+")) }
      .filter { it.size >= 2 && it[1] == "device" }.map { it[0] }.toList()
    val targetReady = address in devices
    return mapOf("connected" to targetReady, "targetSerial" to if (targetReady) address else "", "devices" to if (targetReady) devices else emptyList<String>(), "output" to listOf(start.output, connection.output, devicesResult.output).filter { it.isNotBlank() }.joinToString("\n"))
  }

  private fun discoverAdbEndpoints(serviceType: String): List<String> {
    repeat(3) { attempt ->
      val endpoints = discoverAdbEndpointsOnce(serviceType)
      if (endpoints.isNotEmpty()) return endpoints
      if (attempt < 2) Thread.sleep(350L * (attempt + 1))
    }
    return emptyList()
  }

  private fun discoverAdbEndpointsOnce(serviceType: String): List<String> {
    val context = appContext.reactContext?.applicationContext ?: throw IllegalStateException("Contexto Android no disponible")
    val nsd = context.getSystemService(NsdManager::class.java) ?: return emptyList()
    val localAddresses = java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
      .flatMap { it.inetAddresses.toList() }.mapNotNull { it.hostAddress?.substringBefore('%') }.toSet()
    val result = java.util.concurrent.atomic.AtomicReference<List<String>?>(null)
    val latch = CountDownLatch(1)
    val discovery = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(regType: String) = Unit
      override fun onServiceFound(info: NsdServiceInfo) {
        if (result.get() != null || !info.serviceType.replace(".", "").endsWith(serviceType.replace(".", ""))) return
        runCatching {
          nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
              val host = serviceInfo.host?.hostAddress?.substringBefore('%') ?: return
              if (host !in localAddresses && host != "127.0.0.1") return
              result.compareAndSet(null, listOf("127.0.0.1:${serviceInfo.port}", "$host:${serviceInfo.port}"))
              latch.countDown()
            }
          })
        }
      }
      override fun onServiceLost(info: NsdServiceInfo) = Unit
      override fun onDiscoveryStopped(serviceType: String) = Unit
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = latch.countDown()
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = latch.countDown()
    }
    return try {
      nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discovery)
      latch.await(7, TimeUnit.SECONDS)
      result.get().orEmpty()
    } finally {
      runCatching { nsd.stopServiceDiscovery(discovery) }
    }
  }

  private fun runAdb(adb: String, args: List<String>, timeoutSeconds: Long): CommandResult {
    val process = adbProcessBuilder(adb, args).start()
    val output = StringBuilder()
    val outputLock = Any()
    val outputThread = thread(name = "NetADB-command-output", isDaemon = true) {
      // Drain output concurrently to prevent a full pipe from blocking the process.
      try {
        process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
          lines.forEach { line ->
            synchronized(outputLock) {
              if (output.length < 2_000_000) output.append(line).append('\n')
            }
          }
        }
      } catch (_: Exception) {
        // Process termination closes the output stream.
      }
    }
    val finished = waitForProcess(process, timeoutSeconds, TimeUnit.SECONDS)
    if (!finished) terminateProcess(process)
    outputThread.join(1500)
    val outputText = synchronized(outputLock) { output.toString() }
    return CommandResult(outputText, if (finished) process.exitValue() else 124)
  }

  private fun stopLogcatInternal() {
    val process = logcatProcess
    val worker = logcatThread
    process?.destroy()
    if (process != null) {
      val exited = runCatching { waitForProcess(process, 1, TimeUnit.SECONDS) }.getOrDefault(false)
      if (!exited) terminateProcess(process)
    }
    if (worker != null && worker !== Thread.currentThread()) {
      runCatching { worker.join(4500) }
    }
    logcatProcess = null
    logcatThread = null
  }

  private fun sendShellState(serial: String, state: String, message: String? = null, exitCode: Int? = null) {
    val payload = mutableMapOf<String, Any>("serial" to serial, "state" to state)
    if (message != null) payload["message"] = message
    if (exitCode != null) payload["exitCode"] = exitCode
    sendEvent("onShellState", payload)
  }

  private fun closeShellInternal(emitClosed: Boolean = true) {
    val process: JavaProcess?
    val input: BufferedWriter?
    val worker: Thread?
    val serial: String?
    synchronized(shellLock) {
      process = shellProcess
      input = shellInput
      worker = shellThread
      serial = shellSerial
      shellProcess = null
      shellInput = null
      shellThread = null
      shellSerial = null
    }
    if (process != null) {
      runCatching { input?.close() }
      process.destroy()
      if (!runCatching { waitForProcess(process, 300, TimeUnit.MILLISECONDS) }.getOrDefault(false)) terminateProcess(process)
    }
    if (worker != null && worker !== Thread.currentThread()) runCatching { worker.join(300) }
    if (emitClosed && serial != null) sendShellState(serial, "closed")
  }

  private fun isProcessAlive(process: JavaProcess): Boolean = try {
    process.exitValue()
    false
  } catch (_: IllegalThreadStateException) {
    true
  }

  private fun waitForProcess(process: JavaProcess, timeout: Long, unit: TimeUnit): Boolean {
    val timeoutNanos = unit.toNanos(timeout)
    val startedAtNanos = System.nanoTime()
    while (isProcessAlive(process)) {
      val elapsedNanos = System.nanoTime() - startedAtNanos
      val remainingNanos = timeoutNanos - elapsedNanos
      if (remainingNanos <= 0L) return false
      val sleepMillis = TimeUnit.NANOSECONDS.toMillis(remainingNanos).coerceIn(1L, 50L)
      try {
        Thread.sleep(sleepMillis)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        return !isProcessAlive(process)
      }
    }
    return true
  }

  private fun terminateProcess(process: JavaProcess, waitMillis: Long = 500L) {
    if (!isProcessAlive(process)) return
    process.destroy()
    if (waitForProcess(process, waitMillis, TimeUnit.MILLISECONDS)) return
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      process.destroyForcibly()
      waitForProcess(process, 1_000L, TimeUnit.MILLISECONDS)
    }
  }

  private fun hasUsageAccess(context: android.content.Context): Boolean {
    val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
    return appOps.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS,
      AndroidProcess.myUid(),
      context.packageName,
    ) == AppOpsManager.MODE_ALLOWED
  }

  private fun queryStandardNetworkStats(context: android.content.Context, uid: Int): Pair<String, Boolean> {
    if (!hasUsageAccess(context)) {
      return "Acceso de uso no concedido; Android no permite leer estadísticas por UID." to false
    }
    val manager = context.getSystemService(NetworkStatsManager::class.java)
      ?: return "NetworkStatsManager no está disponible en este dispositivo." to false
    val end = System.currentTimeMillis()
    val start = end - 24L * 60L * 60L * 1000L
    var rxBytes = 0L
    var txBytes = 0L
    var rxPackets = 0L
    var txPackets = 0L
    var queried = false
    val lines = mutableListOf<String>()
    for (networkType in intArrayOf(ConnectivityManager.TYPE_WIFI, ConnectivityManager.TYPE_MOBILE)) {
      try {
        val stats = manager.queryDetailsForUid(networkType, null, start, end, uid)
        val bucket = android.app.usage.NetworkStats.Bucket()
        while (stats.hasNextBucket()) {
          stats.getNextBucket(bucket)
          queried = true
          rxBytes += bucket.rxBytes
          txBytes += bucket.txBytes
          rxPackets += bucket.rxPackets
          txPackets += bucket.txPackets
        }
        stats.close()
      } catch (_: SecurityException) {
        // Some Android builds expose usage access but still reject one transport.
      } catch (_: RuntimeException) {
        // Treat an unavailable transport as missing data, not as zero traffic.
      }
    }
    lines += "Ventana: últimas 24 horas"
    lines += "RX: $rxBytes bytes · $rxPackets paquetes"
    lines += "TX: $txBytes bytes · $txPackets paquetes"
    return lines.joinToString("\n") to queried
  }

  private fun requireValidPackageName(packageName: String) {
    require(packageName.matches(Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+"))) { "Nombre de paquete inválido" }
  }

  private fun <T> withShizukuUserService(action: (INetadbShizukuService) -> T): T {
    check(Shizuku.pingBinder()) { "Shizuku no está iniciado" }
    check(Shizuku.getUid() == 2000) { "NetADB solo admite Shizuku en modo ADB/shell (UID 2000), no root/Sui" }
    check(Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) { "Concede a NetADB el permiso solicitado en Shizuku" }
    val context = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contexto Android no disponible")
    val args = Shizuku.UserServiceArgs(ComponentName(context, NetadbShizukuUserService::class.java))
      .daemon(false)
      .processNameSuffix("netadb")
      .version(1)
    val latch = CountDownLatch(1)
    var remote: INetadbShizukuService? = null
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        remote = INetadbShizukuService.Stub.asInterface(binder)
        latch.countDown()
      }

      override fun onServiceDisconnected(name: ComponentName) {
        remote = null
        latch.countDown()
      }
    }
    try {
      Shizuku.bindUserService(args, connection)
      check(latch.await(20, TimeUnit.SECONDS)) { "Shizuku UserService no respondió" }
      val service = remote ?: throw IllegalStateException("Shizuku UserService no entregó Binder")
      check(service.asBinder().pingBinder()) { "Shizuku UserService dejó de responder" }
      return action(service)
    } finally {
      runCatching { Shizuku.unbindUserService(args, connection, true) }
    }
  }

  private fun appFilesDir(): File = appContext.reactContext?.applicationContext?.filesDir
    ?: throw IllegalStateException("Contexto Android no disponible")

  private fun isValidAddress(address: String): Boolean {
    val value = address.trim()
    val colon = value.lastIndexOf(':')
    if (colon <= 0) return false
    val host = value.substring(0, colon).trim('[', ']')
    val port = value.substring(colon + 1).toIntOrNull() ?: return false
    return host.isNotEmpty() && host.matches(Regex("[A-Za-z0-9._:-]+")) && port in 1..65535
  }

  private fun adbProcessBuilder(adb: String, args: List<String>): ProcessBuilder {
    val app = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contexto Android no disponible")
    return ProcessBuilder(adb, *args.toTypedArray())
      .directory(app.filesDir)
      .redirectErrorStream(true)
      .apply {
        environment()["HOME"] = app.filesDir.absolutePath
        environment()["TMPDIR"] = app.cacheDir.absolutePath
      }
  }

  private fun adbPath(): String {
    val app = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contexto Android no disponible")
    val path = File(app.applicationInfo.nativeLibraryDir, "libadb.so")
    if (!path.canExecute()) throw IllegalStateException("No se encontró el ejecutable ADB en el APK")
    return path.absolutePath
  }
}
