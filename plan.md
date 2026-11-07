# NetADB — Plan de implementación

## Alcance

Aplicación Android instalable inspirada en la arquitectura local de LADB, usando Android Wireless debugging y un ADB embebido para recopilar diagnósticos de un dispositivo Android accesible por dirección `host:puerto`, con consentimiento explícito en el emparejamiento. El APK se distribuirá por instalación directa, fuera de Google Play. Se conservarán las licencias y avisos de los componentes reutilizados. El proyecto Expo/RN existente se mantiene como base y aporta la interfaz multiplataforma; el módulo Kotlin nativo ejecutará comandos ADB donde React Native no tiene acceso al proceso del sistema.

Las capturas incluirán `dumpsys connectivity`, `netstats`, `dnsresolver` y `wifi`, con `telephony.registry` opcional y una advertencia de privacidad. La app expondrá buffers `main`, `system`, `events`, `radio` y `crash` de logcat, con clasificación visible para acciones/intents, GMS/satélite, Wi‑Fi, DNS, móvil y eventos de disponibilidad/pérdida de red; conservará el stream recibido como TXT compartible. Al iniciar captura o logcat, un Android foreground service conserva el proceso activo al usar otra app, mantiene un bloqueo parcial de CPU mientras la sesión siga activa para favorecer el muestreo con pantalla apagada, y muestra una notificación persistente con estado, serial y contador de líneas. La interfaz advierte el consumo adicional y los ajustes del fabricante aún pueden restringir la red; Android 13+ requiere permiso de notificaciones. El contenido crudo no aparece en la notificación para reducir filtraciones en pantalla bloqueada. El analizador de conntrack aceptará texto pegado/importado manualmente, señalará flujos externos `NEW` dirigidos a la IP local del teléfono y aclarará que el candidato no demuestra recepción por una app; no sigue una ruta de router en vivo. El bugreport será opcional, sujeto a soporte del sistema y confirmación informada, y se compartirá como ZIP independiente del JSON de sesión. La sesión se exportará como archivo JSON transferible.

## Arquitectura y limitaciones

- **Interfaz**: Expo Router, React Native y NativeWind. La ruta inicial será una terminal inspirada en la jerarquía original de LADB: barra compacta de estado, área de salida monoespaciada desplazable y entrada de comandos anclada al borde inferior; pairing/conexión en diálogo táctil. Un catálogo de comandos frecuentes de solo lectura carga el comando elegido en el input y nunca lo ejecuta automáticamente. Diagnóstico y licencias quedan accesibles en pestañas separadas.
- **Módulo Android local**: paquete Expo Module bajo `modules/netadb-bridge/`, escrito en Kotlin, empaquetando `libadb.so` para ABI Android. Empareja con código temporal para la dirección temporal y luego conecta al endpoint ADB independiente, detecta dispositivos y exige selección explícita si hay más de uno. No implementa USB/OTG ni intenta activar depuración o cambiar ajustes protegidos por el usuario.
- **Servicios de diagnóstico**: funciones TypeScript organizadas por capturas, parsing/clasificación, conntrack, sesión y exportación. El parser de conntrack opera sobre texto pegado o importado; no sigue rutas de archivos privados del router ni captura paquetes de red.
- **Persistencia y exportación**: estado de sesión en memoria mientras corre la interfaz; TXT/ZIP/JSON exportados permanecen en almacenamiento privado hasta borrado explícito o desinstalación. Incluye acción confirmada para detener streams y limpiar archivos propios. Evitar telemetría de servidor y no subir datos diagnósticos.
- **APK**: configuración nativa conservando los identificadores de Expo; compilación de release solo mediante la capacidad Dashboard móvil del proyecto, no ejecutando Gradle/EAS release en Sandbox. La build y el APK no se declararán listos hasta observar el resultado real.

Estructura: `app/(tabs)/` para diagnóstico y licencias; `components/` para UI del starter y controles; `lib/diagnostics/` para clasificadores, conntrack y timestamps; `modules/netadb-bridge/` para tipado JS/Kotlin, binarios ADB, FileProvider y avisos; `assets/images/` para identidad nativa; `tests/` para parsers y reglas de clasificación.

## Diseño

Tres direcciones evaluadas: **Terminal Fósforo** (0.07), **Instrumentación Ártica** (0.06), **Radar Nocturno** (0.04). Selección guardada en el blueprint: Terminal Fósforo.

- **Movimiento**: terminales de laboratorio y consola de sistemas, reinterpretadas para una app móvil táctil.
- **Principios**: densidad técnica legible; estado de conexión inequívoco; anomalías con codificación cromática consistente; datos sensibles bajo control del usuario.
- **Color**: base verde-negra casi mate para sesiones largas y bajo deslumbramiento; verde fósforo como identidad y estado sano; ámbar para advertencias, rojo para candidatos entrantes o fallos y cian para DNS.
- **Layout**: terminal como superficie primaria a pantalla completa, con salida seleccionable y scroll automático; entrada “Waiting for connection…” hasta autorizar el shell, barra superior de estado/acciones y pestañas inferiores Terminal/Diagnóstico/Licencias.
- **Elementos distintivos**: indicador LED de sesión; línea de tiempo monoespaciada con marcas UTC; chips de clasificación con borde luminoso discreto.
- **Interacción**: acciones primarias grandes, selección explícita antes de datos sensibles, comandos de catálogo sujetos a confirmación de Enviar, controles de pausa/parada siempre visibles, permisos y limitaciones explicados junto a la acción.
- **Animación**: transiciones breves de opacidad y desplazamiento (120–180 ms); pulso lento solo mientras una captura esté activa; sin movimiento continuo en estados quietos.
- **Tipografía**: JetBrains Mono para terminales, marcas de tiempo y valores; sans de sistema Android para instrucciones y textos largos. Títulos compactos y jerarquía de 12/14/18/24 sp.
- **Esencia de marca**: herramienta local de diagnóstico Android para inspeccionar señales de conectividad con evidencia exportable; precisa, sobria y transparente.
- **Voz**: frases directas y técnicas. Ejemplos: «Empareja este teléfono con su depuración inalámbrica.» «Un flujo observado no confirma que una app haya recibido datos.»
- **Marca e icono**: monograma de enlace/terminal: dos trazos de conexión que forman una N, centrados en un campo verde-negro sin texto pequeño.
- **Color de marca**: verde fósforo `#7CFF6B`.

## Estructura del proyecto

- `app/`: `app/(tabs)/index.tsx` para la terminal, `diagnostics.tsx` para herramientas de diagnóstico y `licenses.tsx` para avisos; navegación Expo Router.
- `components/`: botones, chips de estado, consola y tarjetas de diagnóstico.
- `lib/diagnostics/`: comandos autorizados, clasificación de logcat, parser conntrack, timestamps UTC y exportación.
- `modules/netadb-bridge/`: interfaz TS, Expo Module en Kotlin, shell ADB persistente con eventos de salida, recursos ADB por ABI y licencias.
- `assets/images/`: icono launcher, splash e iconografía adaptive.
- `tests/`: pruebas deterministas para parsers y clasificadores.
