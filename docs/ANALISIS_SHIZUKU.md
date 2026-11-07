# Análisis de integración de Shizuku

Fuentes verificadas:

- https://github.com/RikkaApps/Shizuku
- https://github.com/RikkaApps/Shizuku-API
- https://shizuku.rikka.app/guide/setup/
- https://developer.android.com/develop/connectivity/vpn
- https://developer.android.com/reference/android/net/VpnService
- https://developer.android.com/develop/background-work/services

Hallazgos iniciales:

- Shizuku ejecuta un servidor con identidad ADB/shell (UID 2000) o root (UID 0); una app cliente normal no inicia ese servidor por sí sola.
- La app cliente puede detectar disponibilidad con pingBinder, consultar UID y pedir su propio permiso con requestPermission.
- UserService permite ejecutar código propio en otro proceso con identidad shell/root. Debe implementar un Binder AIDL y definir limpieza explícita.
- La preparación VPN y el consentimiento del sistema son mecanismos distintos de Shizuku. VpnService.prepare/establish no deben sustituirse por una conexión directa app-a-app.

Implementación estándar añadida en NetADB:

- `PackageManager.getInstalledApplications` lista paquetes sin Shizuku.
- `PackageManager.getPackageInfo` devuelve versión, UID, SDK objetivo, fechas y permisos solicitados.
- `NetworkStatsManager.queryDetailsForUid` calcula RX/TX y paquetes agregados de las últimas 24 horas cuando la persona concede `PACKAGE_USAGE_STATS` desde Ajustes.
- Las acciones `force-stop`, `disable-user` y `enable` permanecen deshabilitadas sin Shizuku, porque no tienen equivalente público general para una app normal.
- La interfaz ofrece un botón para abrir `Settings.ACTION_USAGE_ACCESS_SETTINGS` y usa PackageManager automáticamente cuando Shizuku no está disponible.
