# NetADB — Plan de implementación

## Alcance

Aplicación Android instalable inspirada en la arquitectura local de LADB, usando Android Wireless debugging y ADB embebido para recopilar diagnósticos de un dispositivo Android accesible por dirección `host:puerto`, con autorización explícita en el emparejamiento. El APK se distribuirá por instalación directa, fuera de Google Play. Se conservarán las licencias y avisos de todos los componentes redistribuidos. El proyecto Expo/React Native existente se mantiene como base y aporta la interfaz multiplataforma; el módulo Kotlin nativo ejecutará comandos ADB y servicios Android donde React Native no tiene acceso al sistema.

Las capturas incluirán `dumpsys connectivity`, `netstats`, `dnsresolver` y `wifi`, con `telephony.registry` opcional y advertencia de privacidad. La app expondrá buffers `main`, `system`, `events`, `radio` y `crash` de logcat, con clasificación visible para acciones/intents, GMS/satélite, Wi‑Fi, DNS, móvil y eventos de disponibilidad/pérdida de red; conservará el stream recibido como TXT compartible. Al iniciar captura o logcat, un Android foreground service conserva el proceso activo al usar otra app, mantiene un bloqueo parcial de CPU mientras la sesión siga activa para favorecer el muestreo con pantalla apagada y muestra una notificación persistente con estado, serial y contador de líneas. La interfaz advierte el consumo adicional y las restricciones de los fabricantes; Android 13+ requiere permiso de notificaciones. El contenido crudo no aparece en la notificación. El analizador de conntrack acepta texto pegado/importado manualmente, señala flujos externos `NEW` dirigidos a la IP local y aclara que el candidato no demuestra recepción por una app; no sigue rutas de router en vivo. El bugreport es opcional, requiere confirmación informada y se comparte como ZIP independiente. La sesión se exporta como JSON transferible.

Se añade una herramienta independiente de **captura VPN local propia**. La persona inicia el flujo desde NetADB, el sistema Android presenta su consentimiento VPN y la captura se limita al paquete seleccionado. Se integra un motor nativo de túnel y un relay local TCP/UDP, no una aplicación VPN externa. El código de servicio, bridge, selección de app y presentación de metadatos ya está en el proyecto; falta compilarlo y probar la conectividad de extremo a extremo en Android antes de considerarlo disponible. La captura no descifrará TLS ni guardará payload.

## Arquitectura y limitaciones

- **Interfaz**: Expo Router, React Native y NativeWind. La ruta inicial conserva una terminal inspirada en LADB: barra compacta de estado, salida monoespaciada seleccionable/desplazable y entrada anclada al borde inferior; pairing/conexión en diálogo. El catálogo de comandos carga el comando elegido en el input y nunca lo ejecuta automáticamente. Diagnóstico, Apps y Licencias se mantienen como pestañas separadas.
- **Módulo Android local**: paquete Expo Module bajo `modules/netadb-bridge/`, escrito en Kotlin, con `libadb.so` para ABI Android ARM64 y ARMv7. Empareja con código temporal y luego conecta al endpoint ADB independiente; detecta dispositivos y exige selección explícita si hay más de uno. No implementa USB/OTG ni intenta activar depuración o cambiar ajustes protegidos por el usuario.
- **Servicios de diagnóstico**: TypeScript organiza capturas, parsing/clasificación, conntrack, comparación de snapshots, sesión y exportación. El parser conntrack usa texto pegado/importado; no lee rutas privadas de routers ni captura paquetes.
- **Shizuku**: la pestaña Apps usa la API oficial y un `UserService` AIDL en modo ADB/shell UID 2000, sin root/Sui, sin ejecución de procesos obsoleta y sin interpolar texto del usuario en shell. Incluye inventario, inspección de solo lectura y solo las acciones de control autorizadas por la interfaz.
- **VPN local**: un `VpnService` nativo invoca `VpnService.prepare()` desde una acción explícita de NetADB para que Android muestre el consentimiento del sistema. Se establece una interfaz TUN por sesión y `VpnService.Builder.addAllowedApplication()` limita el enrutamiento a un paquete seleccionado, excluyendo el propio NetADB. Los motores [hev-socks5-tunnel](https://github.com/heiher/hev-socks5-tunnel) y [hev-socks5-server](https://github.com/heiher/hev-socks5-server) están vendorizados con revisiones y avisos transitivos fijados en `modules/netadb-bridge/THIRD_PARTY_NOTICES.md`; el bridge JNI reenvía TCP/UDP y emite solo metadatos de destino. La UI muestra estado, contadores de TUN y destinos observados; el servicio en primer plano lleva notificación persistente con parada. Se cierran el TUN y los relays al detener/revocar el servicio o ante un error. No se descifra TLS ni se almacena contenido. En modo sin root la observación se limita principalmente a conexiones salientes iniciadas por la app seleccionada; no demuestra que una conexión entrante no solicitada haya llegado a una app. Android solo admite una VPN activa por usuario/perfil, por lo que la app explica el conflicto y no reemplaza otra VPN silenciosamente. La conectividad TCP/UDP nativa aún requiere build y verificación en dispositivo real.
- **Persistencia y exportación**: estado de sesión en memoria mientras corre la interfaz; TXT/ZIP/JSON exportados permanecen en almacenamiento privado hasta borrado explícito o desinstalación. La captura VPN mantiene metadatos localmente y no guarda payload. No se envían diagnósticos a un servidor.
- **APK**: `eas.json` define perfiles Android `preview` y `production` que producen `.apk` de distribución interna para instalación directa. El Dashboard de Expo realizará la build release; se requiere enlazar el proyecto EAS y disponer de firma Android administrada por EAS. No ejecutar Gradle/EAS release dentro de Sandbox. No declarar el APK listo hasta observar una build real exitosa y una instalación comprobada.

## Diseño

Tres direcciones evaluadas: **Terminal Fósforo** (0.07), **Instrumentación Ártica** (0.06), **Radar Nocturno** (0.04). Selección guardada en el blueprint: Terminal Fósforo.

- **Movimiento**: terminales de laboratorio y consola de sistemas, reinterpretadas para una app móvil táctil.
- **Principios**: densidad técnica legible; estado de conexión inequívoco; anomalías con codificación cromática consistente; datos sensibles bajo control del usuario.
- **Color**: base verde-negra casi mate para sesiones largas y bajo deslumbramiento; verde fósforo como identidad y estado sano; ámbar para advertencias, rojo para candidatos entrantes o fallos y cian para DNS.
- **Layout**: terminal como superficie primaria a pantalla completa, con salida seleccionable y scroll automático; entrada “Waiting for connection…” hasta autorizar el shell, barra superior de estado/acciones y pestañas inferiores Terminal/Diagnóstico/Apps/Licencias.
- **Elementos distintivos**: indicador LED de sesión; línea de tiempo monoespaciada con marcas UTC; chips de clasificación con borde luminoso discreto.
- **Interacción**: acciones primarias grandes, selección explícita antes de datos sensibles, comandos de catálogo sujetos a confirmación de Enviar, controles de pausa/parada siempre visibles, permisos y limitaciones explicados junto a la acción.
- **Animación**: transiciones breves de opacidad y desplazamiento (120–180 ms); pulso lento solo mientras una captura esté activa; sin movimiento continuo en estados quietos.
- **Tipografía**: JetBrains Mono para terminales, marcas de tiempo y valores; sans de sistema Android para instrucciones y textos largos. Títulos compactos y jerarquía de 12/14/18/24 sp.
- **Esencia de marca**: herramienta local de diagnóstico Android para inspeccionar señales de conectividad con evidencia exportable; precisa, sobria y transparente.
- **Voz**: frases directas y técnicas. Ejemplos: «Empareja este teléfono con su depuración inalámbrica.» «Un flujo observado no confirma que una app haya recibido datos.»
- **Marca e icono**: monograma de enlace/terminal: dos trazos de conexión que forman una N, centrados en un campo verde-negro sin texto pequeño.
- **Color de marca**: verde fósforo `#7CFF6B`.

## Estructura del proyecto

- `app/(tabs)/`: terminal, diagnóstico/comparación, Apps/Shizuku y Licencias; navegación Expo Router.
- `components/`: botones, chips de estado, consola y tarjetas de diagnóstico.
- `lib/diagnostics/`: comandos autorizados, clasificadores de logcat, parser conntrack, comparación de snapshots, timestamps UTC y exportación.
- `modules/netadb-bridge/`: interfaz TS, Expo Module Kotlin, shell ADB persistente y eventos, recursos ADB por ABI, Shizuku AIDL/UserService, foreground services, manifiestos, NDK/JNI del túnel VPN y avisos de terceros.
- `assets/images/`: icono launcher, splash e iconografía adaptive.
- `tests/`: pruebas deterministas para parsers, diff de snapshots y reglas de clasificación.
- `docs/ESTADO_Y_PROCESO_APK.md`: estado real, procedimiento de build y pendientes de release.

## Comparación de snapshots y Shizuku

La pantalla **Diagnóstico** permite comparar localmente dos snapshots seleccionados (base y captura más reciente). Compara por archivo/fuente, resume líneas añadidas/eliminadas y agrupa heurísticamente cambios en conectividad, Wi‑Fi, DNS, IP/rutas, telefonía y otros. La interfaz muestra diferencias concretas, errores por fuente y advierte que es comparación textual/heurística, no causa raíz probada. No envía snapshots a un servidor.

La pestaña **Apps** usa Shizuku iniciado como ADB/shell (UID 2000), sin root/Sui. Explica que Shizuku debe estar instalado/iniciado y que en modo inalámbrico puede requerir reinicio tras cada reboot. NetADB pide autorización Shizuku al necesitarla. Permite listar paquetes de sistema y opcionalmente de usuario; filtrar por nombre; distinguir paquetes deshabilitados; inspeccionar datos disponibles del paquete, permisos/componentes expuestos, resumen AppOps y contadores agregados de red por UID. Las acciones son detener forzosamente, deshabilitar para el usuario actual y habilitar, cada una con confirmación; no ofrece desinstalar ni borrar datos y bloquea paquetes esenciales. Las estadísticas por UID no dan destinos IP, dominios ni sockets activos; esa observación corresponde al flujo VPN explícito y separado.

## Inspección profunda

La ficha de paquete es de solo lectura e incluye versión, UID, target SDK, fechas, permisos y componentes que Android exponga, AppOps y estadísticas de tráfico por UID cuando el sistema las permita. Distingue datos ausentes de listas vacías. No se implementa inyección en Zygote, hooks Zygisk/LSPosed, lectura de memoria privada ni captura de contenido TLS.
