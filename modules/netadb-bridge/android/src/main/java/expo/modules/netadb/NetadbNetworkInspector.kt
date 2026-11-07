package expo.modules.netadb

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.TrafficStats
import android.os.Build
import android.telephony.TelephonyManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyDisplayInfo
import androidx.core.content.ContextCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal object NetadbNetworkInspector {
  private data class Transport(val label: String, val id: Int, val minApi: Int = 21)
  private data class Capability(val key: String, val label: String, val id: Int)

  private val transports = listOf(
    Transport("CELULAR", NetworkCapabilities.TRANSPORT_CELLULAR),
    Transport("WI-FI", NetworkCapabilities.TRANSPORT_WIFI),
    Transport("ETHERNET", NetworkCapabilities.TRANSPORT_ETHERNET),
    Transport("BLUETOOTH", NetworkCapabilities.TRANSPORT_BLUETOOTH),
    Transport("VPN", NetworkCapabilities.TRANSPORT_VPN),
    Transport("WI-FI AWARE / P2P", NetworkCapabilities.TRANSPORT_WIFI_AWARE, 26),
    Transport("LOWPAN / IoT", NetworkCapabilities.TRANSPORT_LOWPAN, 27),
  )

  private val capabilities = listOf(
    Capability("internet", "INTERNET", NetworkCapabilities.NET_CAPABILITY_INTERNET),
    Capability("validated", "VALIDATED", NetworkCapabilities.NET_CAPABILITY_VALIDATED),
    Capability("notMetered", "NOT_METERED", NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
    Capability("notRoaming", "NOT_ROAMING", NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING),
    Capability("notVpn", "NOT_VPN", NetworkCapabilities.NET_CAPABILITY_NOT_VPN),
    Capability("captivePortal", "CAPTIVE_PORTAL", NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
  )

  fun snapshot(context: Context): Map<String, Any?> {
    val manager = context.getSystemService(ConnectivityManager::class.java)
      ?: throw IllegalStateException("ConnectivityManager no está disponible")
    val active = manager.activeNetwork
    val rows = manager.allNetworks.mapNotNull { network ->
      val caps = manager.getNetworkCapabilities(network) ?: return@mapNotNull null
      val proxy = runCatching { manager.getLinkProperties(network)?.httpProxy }.getOrNull()
      val proxyDetails = proxy?.let {
        mapOf(
          "host" to it.host,
          "port" to it.port,
          "exclusionList" to it.exclusionList.orEmpty().take(20),
          "pac" to (it.pacFileUrl?.toString()?.takeIf(String::isNotBlank) ?: ""),
        )
      }
      val rowTransports = transports
        .filter { Build.VERSION.SDK_INT >= it.minApi && caps.hasTransport(it.id) }
        .map { it.label }
      val rowCapabilities = capabilities.map { cap ->
        mapOf("key" to cap.key, "label" to cap.label, "present" to caps.hasCapability(cap.id))
      }
      mapOf(
        "label" to if (network == active) "RED PREDETERMINADA" else "RED DISPONIBLE",
        "active" to (network == active),
        "transports" to rowTransports,
        "capabilities" to rowCapabilities,
        "internet" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
        "validated" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
        "notMetered" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
        "notRoaming" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING),
        "notVpn" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN),
        "captivePortal" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
        "cellular" to caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
        "vpn" to caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN),
        "httpProxy" to proxyDetails,
      )
    }
    return mapOf(
      "capturedAt" to System.currentTimeMillis(),
      "apiLevel" to Build.VERSION.SDK_INT,
      "hasActiveNetwork" to (active != null),
      "networkCount" to rows.size,
      "networks" to rows,
      "traffic" to mapOf(
        "deviceTxBytes" to TrafficStats.getTotalTxBytes(),
        "deviceRxBytes" to TrafficStats.getTotalRxBytes(),
        "netadbTxBytes" to TrafficStats.getUidTxBytes(context.applicationInfo.uid),
        "netadbRxBytes" to TrafficStats.getUidRxBytes(context.applicationInfo.uid),
      ),
    )
  }

  @Suppress("DEPRECATION")
  fun cellularType(context: Context): Map<String, Any?> {
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
    if (!granted) return mapOf(
      "available" to false,
      "networkType" to "PERMISO REQUERIDO",
      "note" to "Concede READ_PHONE_STATE al pulsar esta acción para consultar el tipo de radio celular.",
    )
    return try {
      val manager = context.getSystemService(TelephonyManager::class.java)
        ?: return mapOf("available" to false, "networkType" to "NO DISPONIBLE", "note" to "TelephonyManager no está disponible en este dispositivo.")
      val type = manager.dataNetworkType
      val display = readDisplayInfo(manager, ContextCompat.getMainExecutor(context))
      val override = display?.overrideNetworkType ?: TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NONE
      val name = when {
        type == TelephonyManager.NETWORK_TYPE_NR -> "5G NR (SA)"
        override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA -> "5G NR (NSA)"
        override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA_MMWAVE -> "5G NR NSA · mmWave reportado"
        Build.VERSION.SDK_INT >= 31 && override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_ADVANCED -> "5G NR avanzado / 5G+"
        type == TelephonyManager.NETWORK_TYPE_LTE -> "LTE / 4G"
        type == TelephonyManager.NETWORK_TYPE_HSPAP -> "HSPA+ / 3G"
        type == TelephonyManager.NETWORK_TYPE_HSPA -> "HSPA / 3G"
        type == TelephonyManager.NETWORK_TYPE_HSUPA -> "HSUPA / 3G"
        type == TelephonyManager.NETWORK_TYPE_HSDPA -> "HSDPA / 3G"
        type == TelephonyManager.NETWORK_TYPE_UMTS -> "UMTS / 3G"
        type == TelephonyManager.NETWORK_TYPE_EDGE -> "EDGE / 2G"
        type == TelephonyManager.NETWORK_TYPE_GPRS -> "GPRS / 2G"
        type == TelephonyManager.NETWORK_TYPE_GSM -> "GSM / 2G"
        type == TelephonyManager.NETWORK_TYPE_IWLAN -> "IWLAN"
        type == TelephonyManager.NETWORK_TYPE_UNKNOWN -> "DESCONOCIDO"
        else -> "TIPO $type"
      }
      mapOf(
        "available" to true,
        "networkType" to name,
        "note" to when {
          type == TelephonyManager.NETWORK_TYPE_NR -> "Android reporta NR para la conexión de datos 5G Standalone."
          override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA -> "Android y la política de operador reportan 5G Non-Standalone sobre LTE."
          override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA_MMWAVE -> "El operador reporta NR NSA en mmWave; es información de visualización y puede depender del equipo y operador."
          Build.VERSION.SDK_INT >= 31 && override == TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_ADVANCED -> "Android informa NR avanzado según la política del operador; puede incluir mmWave, pero no identifica por sí solo la banda física."
          type == TelephonyManager.NETWORK_TYPE_LTE -> "El módem informa LTE. 5G NSA podría no estar reportado por el operador o el dispositivo en esta consulta."
          else -> "Tipo de radio reportado por TelephonyManager; puede no haber servicio celular en este dispositivo."
        },
      )
    } catch (error: SecurityException) {
      mapOf("available" to false, "networkType" to "SIN ACCESO", "note" to (error.message ?: "Android denegó el acceso al tipo de radio."))
    } catch (error: Exception) {
      mapOf("available" to false, "networkType" to "ERROR", "note" to (error.message ?: "No se pudo leer el tipo de radio."))
    }
  }

  @Suppress("DEPRECATION")
  private fun readDisplayInfo(manager: TelephonyManager, executor: java.util.concurrent.Executor): TelephonyDisplayInfo? {
    if (Build.VERSION.SDK_INT < 30) return null
    val latch = CountDownLatch(1)
    val result = AtomicReference<TelephonyDisplayInfo?>(null)
    val listener = object : PhoneStateListener(executor) {
      override fun onDisplayInfoChanged(telephonyDisplayInfo: TelephonyDisplayInfo) {
        result.set(telephonyDisplayInfo)
        latch.countDown()
      }
    }
    return try {
      manager.listen(listener, PhoneStateListener.LISTEN_DISPLAY_INFO_CHANGED)
      latch.await(650, TimeUnit.MILLISECONDS)
      result.get()
    } finally {
      runCatching { manager.listen(listener, PhoneStateListener.LISTEN_NONE) }
    }
  }
}
