package expo.modules.netadb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.LinkedHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * User-started, per-application VPN capture. The TUN traffic is relayed by Hev's
 * bundled SOCKS5 server and transparent tunnel; packet contents are not persisted.
 */
class NetadbVpnService : VpnService() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val stopRequested = AtomicBoolean(false)
  private val engineLock = Any()
  private var foregroundStarted = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var tunnelFd: ParcelFileDescriptor? = null
  private var serverStarted = false
  private var tunnelStarted = false
  private var startThread: Thread? = null
  private var engineCheck = object : Runnable {
    override fun run() {
      if (currentState != STATE_RUNNING || stopRequested.get()) return
      val serverOk = runCatching { NetadbSocks5ServerNative.Socks5IsRunning() }.getOrDefault(false)
      val tunnelOk = runCatching { NetadbSocks5TunnelNative.TProxyIsRunning() }.getOrDefault(false)
      if (!serverOk || !tunnelOk) {
        failAndStop("El motor local dejó de responder; Android restauró el enrutamiento normal.")
        return
      }
      mainHandler.postDelayed(this, ENGINE_CHECK_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    runningService = this
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        requestStop("Captura detenida por la persona.")
        return START_NOT_STICKY
      }
      ACTION_START -> {
        val packageName = intent.getStringExtra(EXTRA_PACKAGE).orEmpty()
        if (packageName.isBlank()) {
          failAndStop("No se indicó una aplicación objetivo.")
          return START_NOT_STICKY
        }
        if (currentState == STATE_STARTING || currentState == STATE_RUNNING) {
          if (currentPackage != packageName) {
            failAndStop("Detén la captura actual antes de elegir otra aplicación.")
          }
          return START_NOT_STICKY
        }
        stopRequested.set(false)
        currentPackage = packageName
        setState(STATE_STARTING, "Preparando captura local para $packageName.")
        NetadbVpnEventStore.clear()
        ensureForeground()
        startThread = thread(name = "NetADB-vpn-start", isDaemon = true) { startCapture(packageName) }
        return START_NOT_STICKY
      }
      else -> {
        stopSelf(startId)
        return START_NOT_STICKY
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

  override fun onRevoke() {
    requestStop("Android revocó el permiso de VPN; la captura quedó detenida.", failed = true)
    super.onRevoke()
  }

  override fun onDestroy() {
    mainHandler.removeCallbacks(engineCheck)
    if (!stopRequested.get()) {
      stopRequested.set(true)
      stopEnginesAndCloseTun()
      if (currentState == STATE_RUNNING || currentState == STATE_STARTING) {
        setState(STATE_IDLE, "La VPN local está detenida.")
      }
      currentPackage = ""
      NetadbVpnEventStore.clear()
    }
    if (runningService === this) runningService = null
    releaseWakeLock()
    if (foregroundStarted) stopForeground(STOP_FOREGROUND_REMOVE)
    foregroundStarted = false
    super.onDestroy()
  }

  private fun startCapture(packageName: String) {
    try {
      check(VpnService.prepare(this) == null) { "Falta autorización VPN de Android. Autoriza y vuelve a iniciar." }
      check(!hasOtherVpn(this)) { "Hay otra VPN activa. Detén esa VPN explícitamente antes de iniciar NetADB." }
      validateTargetPackage(packageName)
      check(!stopRequested.get()) { "Inicio cancelado." }

      val tcpPort = findLoopbackPort()
      val configDir = File(filesDir, "netadb-vpn").apply { mkdirs() }
      val serverConfig = File(configDir, "server.yml")
      val tunnelConfig = File(configDir, "tunnel.yml")
      serverConfig.writeText(serverConfiguration(tcpPort), Charsets.UTF_8)
      tunnelConfig.writeText(tunnelConfiguration(tcpPort), Charsets.UTF_8)

      synchronized(engineLock) {
        check(!stopRequested.get()) { "Inicio cancelado." }
        check(NetadbSocks5ServerNative.Socks5StartService(serverConfig.absolutePath)) {
          "No se pudo iniciar el relay SOCKS5 local."
        }
        serverStarted = true
        check(waitForLoopbackServer(tcpPort)) { "El relay SOCKS5 no abrió su puerto local." }
        check(!stopRequested.get()) { "Inicio cancelado." }

        val builder = Builder()
          .setSession("NetADB · captura por aplicación")
          .setMtu(TUN_MTU)
          .setBlocking(false)
          .addAddress(TUN_IPV4_ADDRESS, 32)
          .addRoute("0.0.0.0", 0)
          .addAddress(TUN_IPV6_ADDRESS, 128)
          .addRoute("::", 0)
          .addAllowedApplication(packageName)

        currentDnsServers(this).forEach { dns -> runCatching { builder.addDnsServer(dns) } }
        check(!hasOtherVpn(this)) {
          "Se activó otra VPN antes de establecer el TUN. NetADB no la reemplazará."
        }
        // establish() publica inmediatamente una red VPN en ConnectivityManager. Marca
        // nuestra interfaz como propia antes de que Android la haga visible; de lo
        // contrario, el chequeo de concurrencia puede confundir nuestro TUN con otra VPN
        // y detener el arranque justo después de mostrar el consentimiento.
        tunnelFd = builder.establish() ?: throw IllegalStateException("Android no pudo crear la interfaz VPN TUN.")
        ownVpnEstablished = true
        check(!stopRequested.get()) { "Inicio cancelado." }
        check(NetadbSocks5TunnelNative.TProxyStartService(tunnelConfig.absolutePath, tunnelFd!!.fd)) {
          "No se pudo iniciar el túnel TCP/UDP local."
        }
        tunnelStarted = true
      }

      Thread.sleep(250)
      check(NetadbSocks5ServerNative.Socks5IsRunning()) { "El relay SOCKS5 se cerró durante el inicio." }
      check(NetadbSocks5TunnelNative.TProxyIsRunning()) { "El túnel se cerró durante el inicio." }
      check(!stopRequested.get()) { "Inicio cancelado." }
      mainHandler.post {
        if (!stopRequested.get()) {
          setState(STATE_RUNNING, "Captura activa solo para $packageName.")
          refreshNotification()
          mainHandler.removeCallbacks(engineCheck)
          mainHandler.postDelayed(engineCheck, ENGINE_CHECK_MS)
        }
      }
    } catch (error: Throwable) {
      val reason = error.message?.takeIf { it.isNotBlank() } ?: "Falló el inicio de la VPN local."
      failAndStop(reason)
    }
  }

  private fun validateTargetPackage(target: String) {
    require(target.matches(Regex("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+"))) { "Nombre de paquete inválido." }
    require(target != packageName) { "NetADB no puede capturarse a sí misma como aplicación objetivo." }
    @Suppress("DEPRECATION")
    packageManager.getApplicationInfo(target, 0)
  }

  private fun waitForLoopbackServer(port: Int): Boolean {
    repeat(40) {
      if (stopRequested.get()) return false
      if (!runCatching { NetadbSocks5ServerNative.Socks5IsRunning() }.getOrDefault(false)) return false
      val connected = runCatching {
        Socket().use { socket -> socket.connect(java.net.InetSocketAddress("127.0.0.1", port), 150); true }
      }.getOrDefault(false)
      if (connected) return true
      Thread.sleep(100)
    }
    return false
  }

  private fun serverConfiguration(port: Int): String = """
    main:
      workers: 2
      port: $port
      listen-address: '127.0.0.1'
      udp-port: 0
      udp-listen-address: '127.0.0.1'
      udp-public-address-v4: '127.0.0.1'
      domain-address-type: unspec
    misc:
      log-level: error
      connect-timeout: 10000
      tcp-read-write-timeout: 300000
      udp-read-write-timeout: 60000
  """.trimIndent() + "\n"

  private fun tunnelConfiguration(port: Int): String = """
    misc:
      task-stack-size: 8192
    tunnel:
      mtu: $TUN_MTU
      icmp: 'reply'
    socks5:
      port: $port
      address: '127.0.0.1'
      udp: 'udp'
  """.trimIndent() + "\n"

  private fun ensureForeground() {
    if (foregroundStarted) return
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    foregroundStarted = true
    val manager = getSystemService(PowerManager::class.java)
    wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NetADB:VpnCapture").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun refreshNotification() {
    if (!foregroundStarted) return
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    val contentIntent = launch?.let { PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable) }
    val stopIntent = Intent(this, NetadbVpnService::class.java).setAction(ACTION_STOP)
    val stopPendingIntent = PendingIntent.getService(this, 2, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    val detail = "${currentPackage.ifBlank { "App no seleccionada" }} · metadatos locales · sin descifrado TLS"
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_netadb)
      .setContentTitle(if (currentState == STATE_RUNNING) "NetADB · VPN local activa" else "NetADB · preparando captura VPN")
      .setContentText(detail)
      .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
      .setSubText("Solo el dispositivo · tráfico de una app")
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .addAction(0, "DETENER", stopPendingIntent)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Captura VPN NetADB", NotificationManager.IMPORTANCE_LOW).apply {
        description = "VPN local por aplicación iniciada y detenida explícitamente por la persona"
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun requestStop(finalMessage: String, failed: Boolean = false) {
    if (!stopRequested.compareAndSet(false, true)) return
    mainHandler.removeCallbacks(engineCheck)
    thread(name = "NetADB-vpn-stop", isDaemon = true) {
      stopEnginesAndCloseTun()
      NetadbVpnEventStore.clear()
      mainHandler.post {
        setState(if (failed) STATE_ERROR else STATE_IDLE, finalMessage)
        if (!failed) currentPackage = ""
        if (foregroundStarted) stopForeground(STOP_FOREGROUND_REMOVE)
        foregroundStarted = false
        releaseWakeLock()
        stopSelf()
      }
    }
  }

  private fun failAndStop(reason: String) {
    if (stopRequested.compareAndSet(false, true)) {
      mainHandler.removeCallbacks(engineCheck)
      thread(name = "NetADB-vpn-failure-cleanup", isDaemon = true) {
        stopEnginesAndCloseTun()
        NetadbVpnEventStore.clear()
        mainHandler.post {
          setState(STATE_ERROR, reason.take(240))
          if (foregroundStarted) stopForeground(STOP_FOREGROUND_REMOVE)
          foregroundStarted = false
          releaseWakeLock()
          stopSelf()
        }
      }
    }
  }

  private fun stopEnginesAndCloseTun() {
    synchronized(engineLock) {
      if (tunnelStarted) {
        runCatching { NetadbSocks5TunnelNative.TProxyStopService() }
        tunnelStarted = false
      }
      if (serverStarted) {
        runCatching { NetadbSocks5ServerNative.Socks5StopService() }
        serverStarted = false
      }
      runCatching { tunnelFd?.close() }
      tunnelFd = null
      ownVpnEstablished = false
    }
  }

  private fun releaseWakeLock() {
    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    wakeLock = null
  }

  private fun setState(state: String, detail: String) {
    currentState = state
    currentMessage = detail
    refreshNotification()
  }

  companion object {
    private const val CHANNEL_ID = "netadb_vpn"
    private const val NOTIFICATION_ID = 7315
    private const val EXTRA_PACKAGE = "targetPackage"
    private const val ACTION_START = "expo.modules.netadb.vpn.START"
    private const val ACTION_STOP = "expo.modules.netadb.vpn.STOP"
    private const val TUN_MTU = 1500
    private const val TUN_IPV4_ADDRESS = "10.111.222.1"
    private const val TUN_IPV6_ADDRESS = "fd00:adb::1"
    private const val ENGINE_CHECK_MS = 2_000L
    private const val STATE_IDLE = "idle"
    private const val STATE_STARTING = "starting"
    private const val STATE_RUNNING = "running"
    private const val STATE_ERROR = "error"

    @Volatile private var runningService: NetadbVpnService? = null
    @Volatile private var ownVpnEstablished = false
    @Volatile private var currentState = STATE_IDLE
    @Volatile private var currentPackage = ""
    @Volatile private var currentMessage = "La captura VPN está detenida."

    fun start(context: Context, targetPackage: String) {
      val intent = Intent(context, NetadbVpnService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_PACKAGE, targetPackage)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, NetadbVpnService::class.java).setAction(ACTION_STOP)
      try {
        context.startService(intent)
      } catch (_: Exception) {
        context.stopService(intent)
      }
    }

    fun isCapturing(): Boolean = currentState == STATE_RUNNING || currentState == STATE_STARTING

    fun hasOtherVpn(context: Context): Boolean {
      if (ownVpnEstablished) return false
      val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
      return manager.allNetworks.any { network ->
        manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
      }
    }

    fun getSnapshot(context: Context): Map<String, Any> {
      val permissionGranted = VpnService.prepare(context) == null
      val stats = if (currentState == STATE_RUNNING) {
        runCatching { NetadbSocks5TunnelNative.TProxyGetStats() }.getOrDefault(longArrayOf(0, 0, 0, 0))
      } else longArrayOf(0, 0, 0, 0)
      return mapOf(
        "permissionGranted" to permissionGranted,
        "otherVpnActive" to hasOtherVpn(context),
        "running" to (currentState == STATE_RUNNING),
        "state" to currentState,
        "packageName" to currentPackage,
        "message" to currentMessage,
        "txPackets" to stats.getOrElse(0) { 0L },
        "txBytes" to stats.getOrElse(1) { 0L },
        "rxPackets" to stats.getOrElse(2) { 0L },
        "rxBytes" to stats.getOrElse(3) { 0L },
        "connections" to NetadbVpnEventStore.snapshot()
      )
    }

    @Suppress("DEPRECATION")
    fun listTargets(context: Context): List<Map<String, Any>> {
      val pm = context.packageManager
      return pm.getInstalledApplications(0)
        .asSequence()
        .filter { it.packageName != context.packageName && (it.flags and ApplicationInfo.FLAG_INSTALLED) != 0 }
        .mapNotNull { app ->
          runCatching {
            val label = pm.getApplicationLabel(app).toString().replace(Regex("[\\r\\n\\u0000]"), " ").take(100)
            mapOf(
              "packageName" to app.packageName,
              "label" to label.ifBlank { app.packageName },
              "systemApp" to ((app.flags and ApplicationInfo.FLAG_SYSTEM) != 0)
            )
          }.getOrNull()
        }
        .sortedWith(compareBy<Map<String, Any>> { (it["label"] as String).lowercase() }.thenBy { it["packageName"] as String })
        .toList()
    }

    @JvmStatic
    fun recordNativeEvent(protocol: String, endpoint: String, direction: String, bytes: Long) {
      if (currentState != STATE_RUNNING && currentState != STATE_STARTING) return
      NetadbVpnEventStore.record(protocol, endpoint, direction, bytes)
    }

    private fun currentDnsServers(context: Context): List<String> {
      val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
      val network = manager.activeNetwork ?: return emptyList()
      return manager.getLinkProperties(network)?.dnsServers.orEmpty()
        .mapNotNull { runCatching { it.hostAddress?.substringBefore('%') }.getOrNull() }
        .filter { it.isNotBlank() }
        .distinct()
        .take(4)
    }

    private fun findLoopbackPort(): Int = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
  }
}

private object NetadbVpnEventStore {
  private const val MAX_EVENTS = 250
  private val events = LinkedHashMap<String, MutableVpnEvent>()

  @Synchronized
  fun clear() = events.clear()

  @Synchronized
  fun record(protocolRaw: String, endpointRaw: String, directionRaw: String, bytes: Long) {
    val protocol = protocolRaw.lowercase().takeIf { it == "tcp" || it == "udp" } ?: return
    val endpoint = endpointRaw.replace(Regex("[\\r\\n\\u0000]"), " ").trim().take(256)
    if (endpoint.isBlank()) return
    val direction = directionRaw.lowercase().takeIf { it == "open" || it == "packet" } ?: "packet"
    val key = "$protocol|$endpoint"
    val now = System.currentTimeMillis()
    val item = events[key]
    if (item == null) {
      if (events.size >= MAX_EVENTS) events.remove(events.keys.first())
      events[key] = MutableVpnEvent(protocol, endpoint, now, now, 1, bytes.coerceAtLeast(0), direction == "open")
    } else {
      item.lastSeen = now
      item.events += 1
      item.bytes += bytes.coerceAtLeast(0)
      item.openObserved = item.openObserved || direction == "open"
    }
  }

  @Synchronized
  fun snapshot(): List<Map<String, Any>> = events.values
    .sortedByDescending { it.lastSeen }
    .map {
      mapOf(
        "protocol" to it.protocol,
        "endpoint" to it.endpoint,
        "firstSeen" to it.firstSeen,
        "lastSeen" to it.lastSeen,
        "events" to it.events,
        "bytes" to it.bytes,
        "openObserved" to it.openObserved
      )
    }

  private data class MutableVpnEvent(
    val protocol: String,
    val endpoint: String,
    val firstSeen: Long,
    var lastSeen: Long,
    var events: Long,
    var bytes: Long,
    var openObserved: Boolean
  )
}
