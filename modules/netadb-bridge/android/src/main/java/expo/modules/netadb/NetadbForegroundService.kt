package expo.modules.netadb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Keeps user-started ADB diagnostics visible while another app is in the foreground. */
class NetadbForegroundService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var targetSerial = ""
  private var status = "Diagnóstico activo"
  private var logcatLines = 0
  private var foregroundStarted = false
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    runningService = this
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(EXTRA_SERIAL)?.let { targetSerial = it }
    intent?.getStringExtra(EXTRA_STATUS)?.let { status = it }
    if (intent?.hasExtra(EXTRA_LINES) == true) logcatLines = intent.getIntExtra(EXTRA_LINES, logcatLines)
    ensureForeground()
    refreshNotification()
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    if (runningService === this) runningService = null
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    if (foregroundStarted) stopForeground(STOP_FOREGROUND_REMOVE)
    foregroundStarted = false
    super.onDestroy()
  }

  private fun ensureForeground() {
    if (foregroundStarted) return
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    foregroundStarted = true
    val powerManager = getSystemService(PowerManager::class.java)
    if (wakeLock?.isHeld != true) {
      wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NetADB:Diagnostics").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun refreshNotification() {
    NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
  }

  private fun postState(serial: String, newStatus: String, lines: Int) {
    mainHandler.post {
      targetSerial = serial
      status = newStatus
      logcatLines = lines.coerceAtLeast(0)
      ensureForeground()
      refreshNotification()
    }
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    val contentIntent = launch?.let { PendingIntent.getActivity(this, 0, it, pendingFlags) }
    val detail = buildString {
      append(status)
      if (targetSerial.isNotBlank()) append(" · ").append(targetSerial)
      append(" · Logcat: ").append(logcatLines).append(" líneas guardadas")
      append(". Toca para volver al registro.")
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_netadb)
      .setContentTitle("NetADB · diagnóstico en curso")
      .setContentText(detail)
      .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
      .setSubText("Registro local · datos no enviados")
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Diagnóstico NetADB", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Estado visible de las capturas ADB iniciadas por la persona"
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  companion object {
    private const val CHANNEL_ID = "netadb_diagnostics"
    private const val NOTIFICATION_ID = 7314
    private const val EXTRA_SERIAL = "serial"
    private const val EXTRA_STATUS = "status"
    private const val EXTRA_LINES = "lines"

    @Volatile private var runningService: NetadbForegroundService? = null

    fun start(context: Context, serial: String, status: String) {
      sendUpdate(context, serial, status, null)
    }

    fun update(context: Context, serial: String, status: String, lines: Int) {
      val current = runningService
      if (current != null) current.postState(serial, status, lines)
      else sendUpdate(context, serial, status, lines)
    }

    fun updateLineCount(lines: Int) {
      val current = runningService ?: return
      current.mainHandler.post {
        current.logcatLines = lines.coerceAtLeast(0)
        current.refreshNotification()
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, NetadbForegroundService::class.java))
    }

    private fun sendUpdate(context: Context, serial: String, status: String, lines: Int?) {
      val intent = Intent(context, NetadbForegroundService::class.java)
        .putExtra(EXTRA_SERIAL, serial)
        .putExtra(EXTRA_STATUS, status)
      if (lines != null) intent.putExtra(EXTRA_LINES, lines)
      ContextCompat.startForegroundService(context, intent)
    }
  }
}
