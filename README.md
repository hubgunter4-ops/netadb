# NetADB

App Android de diagnóstico de conectividad por ADB inalámbrico, con una interfaz React Native/Expo y un módulo Kotlin que integra `libadb.so`. Diseñada para instalación directa fuera de Google Play Store.

## Funciones

- Terminal ADB con jerarquía inspirada en LADB: consola de salida monoespaciada y seleccionable, shell persistente y prompt fijo abajo. Emparejamiento y conexión se gestionan desde un diálogo, y Diagnóstico/Licencias siguen accesibles desde sus pestañas.
- El botón **CMD** abre un catálogo de consultas frecuentes (`getprop`, `id`, `ip addr`, `ip route`, `dumpsys connectivity`, `dumpsys wifi`, paquetes instalados y logcat reciente). Seleccionar solo rellena la línea; nada se ejecuta hasta que la persona pulse **Enviar**. Se permite escribir comandos manualmente.
- Empareja con Android Wireless debugging mediante una dirección `host:puerto` y código de 6 dígitos; luego conecta al endpoint de depuración independiente.
- Detecta los dispositivos autorizados visibles para el daemon ADB integrado. Si hay más de uno, obliga a seleccionar serial antes de capturar.
- Toma snapshots UTC con `dumpsys connectivity`, `netstats`, `dnsresolver` y `wifi`; `telephony.registry` solo se añade por opt-in y puede revelar datos de SIM/celdas.
- Sigue buffers logcat `main`, `system`, `events`, `radio` y `crash` en primer o segundo plano, conserva las líneas recibidas en un TXT privado compartible y clasifica heurísticamente señales de acciones/intents, GMS/satélite, Wi-Fi, DNS, móvil, disponibilidad y pérdida de red. Una notificación persistente muestra el estado y contador, no el contenido crudo.
- Analiza texto conntrack pegado por la persona para destacar flujos globales externos `NEW` que parecen dirigidos a la IP del teléfono. No lee ni sigue en vivo archivos de router; se requiere aportar el registro.
- Genera un bugreport opcional como ZIP y permite compartirlo desde el sistema. Los diagnósticos se mantienen dentro de la app hasta solicitar exportación explícita.
- Exporta una sesión JSON UTC vía FileProvider restringido al almacenamiento privado de NetADB. Licencias completas incluidas en la pantalla Licencias.

Snapshots y eventos visibles se conservan en memoria durante la sesión de pantalla; archivos JSON/TXT/ZIP quedan en el almacenamiento privado de la app hasta borrarlos con **Borrar datos locales** o desinstalar NetADB. Los eventos observados no identifican necesariamente el origen remoto ni prueban que una app recibiera datos. La evidencia depende del sistema, el registro conntrack aportado y la red. NetADB no instala ADB desde Internet ni envía datos a un servidor.

## Uso en Android

1. Usa Android 11 o posterior. En el dispositivo que se diagnosticará, habilita Opciones de desarrollador y **Depuración inalámbrica**. Si se conecta a otro teléfono, ambos deben estar en una red de confianza.
2. Abre **Emparejar dispositivo con código**; introduce su dirección temporal `host:puerto` y el código de 6 cifras en NetADB. El código se usa solo durante pairing.
3. Vuelve a la pantalla principal de Wireless debugging y copia su dirección `host:puerto` distinta para la conexión. Acepta el diálogo de autorización Android si aparece.
4. Si se detectan varios dispositivos, selecciona explícitamente el serial. Define intervalo y duración; `0` deja la captura hasta que la persona la detenga. El intervalo mínimo es 5 segundos.
5. Detén logcat/snapshots cuando termines. Revisa los avisos y usa **Compartir sesión**, **Compartir logcat completo** o **Crear bugreport** solo si quieres exportar datos potencialmente sensibles.

Al iniciar snapshots, logcat o bugreport, permite la notificación de NetADB si Android la solicita. El servicio foreground mantiene visible el estado y número de líneas al abrir otra app y usa un bloqueo parcial de CPU mientras la tarea está activa para sostener el muestreo con la pantalla apagada. Esto puede elevar el consumo de batería; detén snapshots/logcat cuando acabes. La captura aún puede verse afectada por ajustes de ahorro de batería del fabricante o restricciones de red; si se interrumpe, revisa esos ajustes manualmente. La notificación no muestra líneas crudas para evitar revelar datos sensibles en la pantalla bloqueada.

La app usa Wireless debugging; no implementa conexión USB física/OTG ni acceso en vivo a una ruta del router. El analizador conntrack acepta el contenido que se pega en la app y contempla la tupla de respuesta para detectar un posible DNAT.

## Desarrollo

```sh
pnpm install
pnpm check
pnpm test
pnpm dev
```

Los módulos nativos locales están en `modules/netadb-bridge/android/`; Expo Autolinking los registra desde `./modules`. Se empaquetan ejecutables ADB ARM64 y ARMv7 junto con sus avisos de licencia.

## APK

`eas.json` configura `preview` y `production` con `android.buildType: "apk"` y `distribution: "internal"`. Usa el flujo **Android Build** del Dashboard de Expo con uno de esos perfiles; enlaza el proyecto EAS y administra el keystore Android allí. No guardes credenciales de firma en Git ni ejecutes Gradle/EAS release desde este Sandbox. Comparte el APK solo después de que la build real termine correctamente y se pruebe en un dispositivo. Distribuirlo por instalación directa; no subirlo a Google Play Store. Consulta [`docs/ESTADO_Y_PROCESO_APK.md`](docs/ESTADO_Y_PROCESO_APK.md) para los pasos y pendientes.

## Referencias y licencias

- Arquitectura de referencia: [tytydraco/LADB](https://github.com/tytydraco/ladb) y [releases de Jobians](https://github.com/Jobians/ladb-apk-download/releases).
- Avisos: [`modules/netadb-bridge/THIRD_PARTY_NOTICES.md`](modules/netadb-bridge/THIRD_PARTY_NOTICES.md), [`LADB-LICENSE.txt`](modules/netadb-bridge/LADB-LICENSE.txt) y [`ADB-LIBRARY-LICENSE.txt`](modules/netadb-bridge/ADB-LIBRARY-LICENSE.txt). Los textos completos también se distribuyen como recursos consultables en el APK.

## Comparar snapshots

La pestaña **Diagnóstico** permite elegir dos capturas de la sesión y comparar localmente cada fuente, con líneas añadidas/eliminadas, errores por captura y categorías heurísticas (conectividad, Wi‑Fi, DNS, IP/rutas, telefonía). El comparador no altera las fuentes ni demuestra por sí mismo una causa raíz.

## Apps, Shizuku e inspección sin root

La pestaña **Apps** requiere instalar e iniciar Shizuku en modo ADB/shell, conceder su permiso a NetADB y permanecer en UID 2000; NetADB rechaza el backend root/Sui. Shizuku puede reiniciarse tras un reboot. La ficha consulta el dump de paquete, permisos/componentes que Android expone, AppOps y filas de estadísticas netstats asociadas al UID cuando están disponibles. Detener, deshabilitar y habilitar son acciones separadas, con confirmación. No se desinstala ni se borran datos.

Estas estadísticas son contadores agregados por UID; no revelan por sí solas IPs/dominios remotos ni sockets vivos. Sin root tampoco es posible inyectar código en Zygote ni leer la memoria privada de otra app. La captura VPN propia consentida ya tiene código de servicio/bridge, selección de paquete, callback de metadatos y fuentes nativas Hev TCP/UDP vendorizadas con licencias completas. **Aún no hay build nativa ni APK verificado**: la conectividad debe probarse en EAS y en un dispositivo Android antes de ofrecerla como lista. Android permite una VPN activa por usuario/perfil; la captura se limita a metadatos, no descifra TLS y observa principalmente conexiones salientes.

La documentación del estado, el procedimiento EAS y las tareas pendientes está en [`docs/ESTADO_Y_PROCESO_APK.md`](docs/ESTADO_Y_PROCESO_APK.md). La configuración [`eas.json`](eas.json) contiene perfiles `preview` y `production` para APK interno; aún se requiere enlazar el proyecto Expo, confirmar credenciales de firma y completar una build real. [PCAPdroid](https://github.com/emanuele-f/PCAPdroid) sigue siendo una alternativa externa, pero no es la arquitectura elegida para NetADB.

## Fuentes técnicas

- [Shizuku API: UserService, niveles ADB/root y permisos](https://github.com/RikkaApps/Shizuku-API)
- [Android VpnService](https://developer.android.com/develop/connectivity/vpn) y [NetworkStatsManager](https://developer.android.com/reference/android/app/usage/NetworkStatsManager)
- [Guía PCAPdroid: captura sin root y límites](https://emanuele-f.github.io/PCAPdroid/quick_start.html) y [API para apps externas](https://github.com/emanuele-f/PCAPdroid/blob/master/docs/app_api.md)
