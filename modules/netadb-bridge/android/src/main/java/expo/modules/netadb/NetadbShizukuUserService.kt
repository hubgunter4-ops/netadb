package expo.modules.netadb

import android.os.RemoteException
import androidx.annotation.Keep
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

@Keep
class NetadbShizukuUserService : INetadbShizukuService.Stub() {
  override fun listPackages(includeUserApps: Boolean): String {
    val userIdResult = runCommand(listOf("/system/bin/am", "get-current-user"))
    val userId = userIdResult.output.trim().lineSequence().lastOrNull()?.toIntOrNull()
      ?: throw RemoteException("No se pudo determinar el usuario Android actual")
    val system = packageSet(listOf("/system/bin/pm", "list", "packages", "--user", userId.toString(), "-s"))
    val user = if (includeUserApps) packageSet(listOf("/system/bin/pm", "list", "packages", "--user", userId.toString(), "-3")) else emptySet()
    val disabled = packageSet(listOf("/system/bin/pm", "list", "packages", "--user", userId.toString(), "-d"))
    val result = JSONArray()
    (system.map { it to "system" } + user.map { it to "user" })
      .distinctBy { it.first }
      .sortedBy { it.first.lowercase() }
      .forEach { (packageName, kind) ->
        result.put(JSONObject().put("packageName", packageName).put("kind", kind).put("disabled", packageName in disabled).put("protected", packageName in protectedPackages))
      }
    return result.toString()
  }

  override fun inspectPackage(packageName: String): String {
    if (!packageName.matches(Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+"))) {
      throw RemoteException("Nombre de paquete inválido")
    }
    val packageResult = runCommand(listOf("/system/bin/dumpsys", "package", packageName))
    if (packageResult.exitCode != 0 || packageResult.output.isBlank()) {
      throw RemoteException(packageResult.output.ifBlank { "Android no entregó el detalle de este paquete" })
    }
    val dump = packageResult.output
    val uid = Regex("\\buserId=(\\d+)").find(dump)?.groupValues?.getOrNull(1)?.toIntOrNull()
      ?: Regex("\\bappId=(\\d+)").find(dump)?.groupValues?.getOrNull(1)?.toIntOrNull()
    val appOps = runCommand(listOf("/system/bin/cmd", "appops", "get", packageName))
    val networkStats = if (uid != null) {
      val stats = runCommand(listOf("/system/bin/dumpsys", "netstats"))
      val uidPattern = Regex("\\buid[=\\s]+${Regex.escape(uid.toString())}(?:\\D|$)")
      stats.output.lineSequence().filter { uidPattern.containsMatchIn(it) }.take(80).joinToString("\n")
    } else ""
    val versionCode = Regex("\\bversionCode=(\\d+)").find(dump)?.groupValues?.getOrNull(1)?.toLongOrNull()
    val versionName = Regex("\\bversionName=([^\\s]+)").find(dump)?.groupValues?.getOrNull(1)
    val targetSdk = Regex("\\btargetSdk=(\\d+)").find(dump)?.groupValues?.getOrNull(1)?.toIntOrNull()
    val firstInstallTime = Regex("(?m)^\\s*firstInstallTime=([^\\n]+)").find(dump)?.groupValues?.getOrNull(1)?.trim()
    val lastUpdateTime = Regex("(?m)^\\s*lastUpdateTime=([^\\n]+)").find(dump)?.groupValues?.getOrNull(1)?.trim()
    return JSONObject()
      .put("packageName", packageName)
      .put("uid", uid ?: JSONObject.NULL)
      .put("versionCode", versionCode ?: JSONObject.NULL)
      .put("versionName", versionName ?: JSONObject.NULL)
      .put("targetSdk", targetSdk ?: JSONObject.NULL)
      .put("firstInstallTime", firstInstallTime ?: JSONObject.NULL)
      .put("lastUpdateTime", lastUpdateTime ?: JSONObject.NULL)
      .put("packageDump", dump.take(24_000))
      .put("appOps", appOps.output.take(8_000))
      .put("appOpsExitCode", appOps.exitCode)
      .put("networkStats", networkStats.take(8_000))
      .put("networkStatsAvailable", networkStats.isNotBlank())
      .toString()
  }

  override fun controlPackage(packageName: String, action: String): String {
    if (!packageName.matches(Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+"))) {
      throw RemoteException("Nombre de paquete inválido")
    }
    if (action !in setOf("force-stop", "disable-user", "enable")) {
      throw RemoteException("Acción no permitida")
    }
    if (packageName in protectedPackages && action != "enable") {
      throw RemoteException("Acción bloqueada para un paquete esencial del sistema")
    }
    val userResult = runCommand(listOf("/system/bin/am", "get-current-user"))
    val userId = userResult.output.trim().lineSequence().lastOrNull()?.toIntOrNull()
      ?: throw RemoteException("No se pudo determinar el usuario Android actual")
    val command = when (action) {
      "force-stop" -> listOf("/system/bin/am", "force-stop", "--user", userId.toString(), packageName)
      "disable-user" -> listOf("/system/bin/pm", "disable-user", "--user", userId.toString(), packageName)
      "enable" -> listOf("/system/bin/pm", "enable", "--user", userId.toString(), packageName)
      else -> throw RemoteException("Acción no permitida")
    }
    val result = runCommand(command)
    return JSONObject()
      .put("success", result.exitCode == 0)
      .put("exitCode", result.exitCode)
      .put("output", result.output.take(4000))
      .toString()
  }

  override fun destroy() {
    System.exit(0)
  }

  private data class CommandResult(val output: String, val exitCode: Int)

  private fun packageSet(command: List<String>): Set<String> {
    val result = runCommand(command)
    if (result.exitCode != 0) throw RemoteException(result.output.ifBlank { "pm list packages falló (${result.exitCode})" })
    return result.output.lineSequence()
      .map { it.trim().removePrefix("package:").trim() }
      .filter { it.matches(Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")) }
      .toSet()
  }

  private fun runCommand(command: List<String>): CommandResult {
    val process = try {
      ProcessBuilder(command).redirectErrorStream(true).start()
    } catch (error: Exception) {
      throw RemoteException("No se pudo iniciar el comando Android: ${error.message}")
    }
    val output = StringBuilder()
    val reader = thread(name = "NetADB-Shizuku-command-output", isDaemon = true) {
      try {
        BufferedReader(InputStreamReader(process.inputStream, Charsets.UTF_8)).use { stream ->
          var line: String?
          while (stream.readLine().also { line = it } != null) {
            synchronized(output) {
              if (output.length < 512_000) output.append(line).append('\n')
            }
          }
        }
      } catch (_: Exception) { }
    }
    if (!process.waitFor(20, TimeUnit.SECONDS)) {
      process.destroyForcibly()
      reader.join(1000)
      throw RemoteException("El comando Android superó el límite de 20 segundos")
    }
    reader.join(2000)
    val text = synchronized(output) { output.toString().trim() }
    return CommandResult(text, process.exitValue())
  }

  private val protectedPackages = setOf(
    "android",
    "com.android.systemui",
    "com.android.settings",
    "com.android.phone",
    "com.android.server.telecom",
    "com.android.permissioncontroller",
    "com.android.providers.settings",
    "com.android.packageinstaller",
    "com.google.android.gms",
    "com.google.android.gsf",
    "com.google.android.setupwizard"
  )
}
