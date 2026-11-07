package expo.modules.netadb

import android.content.Intent
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedWriter
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class NetadbBridgeModule : Module() {
  private var logcatProcess: Process? = null
  private var logcatThread: Thread? = null
  private val shellLock = Any()
  private var shellProcess: Process? = null
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

    AsyncFunction("getLicenses") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Contexto Android no disponible")
      val ladb = context.resources.openRawResource(R.raw.ladb_license).bufferedReader().use { it.readText() }
      val adb = context.resources.openRawResource(R.raw.adb_library_license).bufferedReader().use { it.readText() }
      mapOf("ladb" to ladb, "adb" to adb)
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
      require(mimeType in setOf("application/json", "application/zip", "text/plain")) { "Tipo de archivo no permitido" }
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
        val completed = process.waitFor(25, TimeUnit.SECONDS)
        if (!completed) process.destroyForcibly()
        completed
      } finally {
        if (process.isAlive) process.destroyForcibly()
        outputThread.join(1500)
      }
      val outputText = synchronized(outputLock) { output.toString() }
      mapOf(
        "success" to (finished && process.exitValue() == 0),
        "output" to outputText.ifBlank { if (finished) "ADB pair terminó sin salida" else "Tiempo de emparejamiento agotado" }
      )
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
      if (process.waitFor(500, TimeUnit.MILLISECONDS)) {
        val output = process.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText().trim() }
        val exitCode = process.exitValue()
        val message = output.ifBlank { "ADB shell terminó al iniciar (código $exitCode)" }
        sendShellState(serial, "error", message = message, exitCode = exitCode)
        return@AsyncFunction mapOf("ready" to false, "serial" to serial, "output" to output)
      }
      if (!process.isAlive) {
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
          val code = if (process.waitFor(2, TimeUnit.SECONDS)) process.exitValue() else 124
          if (process.isAlive) process.destroyForcibly()
          val stillCurrent = synchronized(shellLock) { shellProcess === process }
          if (stillCurrent) sendShellState(serial, if (code == 0) "closed" else "error", exitCode = code)
        } catch (e: Exception) {
          val stillCurrent = synchronized(shellLock) { shellProcess === process }
          if (stillCurrent && process.isAlive) sendShellState(serial, "error", message = e.message ?: "Error leyendo shell")
        } finally {
          synchronized(shellLock) {
            if (shellProcess === process) { shellProcess = null; shellInput = null; shellThread = null; shellSerial = null }
          }
        }
      }
      mapOf("ready" to true, "serial" to serial)
    }

    AsyncFunction("sendShellCommand") { command: String ->
      require(command.isNotBlank() && command.length <= 10000 && !command.contains('\n') && !command.contains('\r')) {
        "Comando vacío, multilínea o demasiado largo"
      }
      synchronized(shellLock) {
        val process = shellProcess ?: return@synchronized false
        val input = shellInput ?: return@synchronized false
        if (!process.isAlive) return@synchronized false
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
            val exited = process.waitFor(2, TimeUnit.SECONDS)
            if (!exited) process.destroyForcibly()
            val exitCode = if (exited || runCatching { process.waitFor(2, TimeUnit.SECONDS) }.getOrDefault(false)) process.exitValue() else 124
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
    val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
    if (!finished) process.destroyForcibly()
    outputThread.join(1500)
    val outputText = synchronized(outputLock) { output.toString() }
    return CommandResult(outputText, if (finished) process.exitValue() else 124)
  }

  private fun stopLogcatInternal() {
    val process = logcatProcess
    val worker = logcatThread
    process?.destroy()
    if (process != null) {
      val exited = runCatching { process.waitFor(1, TimeUnit.SECONDS) }.getOrDefault(false)
      if (!exited) process.destroyForcibly()
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
    val process: Process?
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
      if (!runCatching { process.waitFor(300, TimeUnit.MILLISECONDS) }.getOrDefault(false)) process.destroyForcibly()
    }
    if (worker != null && worker !== Thread.currentThread()) runCatching { worker.join(300) }
    if (emitClosed && serial != null) sendShellState(serial, "closed")
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
