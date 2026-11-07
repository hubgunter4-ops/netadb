# NetADB

App Android de diagnóstico de conectividad por ADB inalámbrico, con una interfaz React Native/Expo y un módulo Kotlin que integra `libadb.so`. Diseñada para instalación directa fuera de Google Play Store.

## Funciones

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

Los módulos nativos locales están en `modules/netadb-bridge/android/`; Expo Autolinking los registra desde `./modules`. Se empaquetan ejecutables ADB ARM64 y ARMv7 junto con ambos avisos de licencia.

## APK

Usa el flujo **Android Build** del Dashboard del proyecto móvil para compilar el APK de release a partir del código aceptado. No ejecutes Gradle/EAS release desde este Sandbox. La build debe completarse correctamente antes de compartir el APK. Distribuir el APK solo por instalación directa; no subirlo a Google Play Store.

## Referencias y licencias

- Arquitectura de referencia: [tytydraco/LADB](https://github.com/tytydraco/ladb) y [releases de Jobians](https://github.com/Jobians/ladb-apk-download/releases).
- Avisos: [`modules/netadb-bridge/THIRD_PARTY_NOTICES.md`](modules/netadb-bridge/THIRD_PARTY_NOTICES.md), [`LADB-LICENSE.txt`](modules/netadb-bridge/LADB-LICENSE.txt) y [`ADB-LIBRARY-LICENSE.txt`](modules/netadb-bridge/ADB-LIBRARY-LICENSE.txt). Los textos completos también se distribuyen como recursos consultables en el APK.
