# Resultados NetADB

## 1. Emparejamiento y sesión ADB inalámbrica
- [ ] La app usa Wireless Debugging de Android y un ADB local embebido; solicita `host:puerto` de emparejamiento y código temporal, luego acepta el `host:puerto` de conexión independiente, sin guardar el código en archivos ni registros. Este APK no implementa USB/OTG.
- [ ] La persona autoriza la depuración en Android. La app ofrece conexión y detección de dispositivos, selección inequívoca si hay varios y estados visibles para emparejando, conectado y error.
- [ ] Si la conexión del endpoint ADB encuentra varios dispositivos, el estado de diagnóstico indica que falta elegir un serial y no presenta la sesión como ya seleccionada.
- [ ] La app no activa ADB ni cambia ajustes seguros del teléfono sin autorización del sistema.

## 2. Capturas periódicas del sistema
- [ ] Captura periódica configurable de `dumpsys connectivity`, `dumpsys netstats`, `dumpsys dnsresolver` y `dumpsys wifi`.
- [ ] Permite configurar intervalo y duración, incluyendo captura hasta detener manualmente; permite incluir `dumpsys telephony.registry` solo con opt-in y advertencia sobre datos SIM/celdas.
- [ ] Guarda cada snapshot con sello UTC y comando ejecutado; fallos parciales se conservan como archivos de diagnóstico.
- [ ] Las capturas continúan al cambiar a otra app mediante un Android foreground service y bloqueo parcial de CPU mientras la sesión está activa; se advierte el mayor consumo de batería, se solicita permiso de notificaciones cuando la versión lo requiere y se muestra una notificación persistente con estado/serial.

## 3. Observación y clasificación de logcat
- [ ] Seguimiento de buffers `main`, `system`, `events`, `radio` y `crash` en primer y segundo plano, con detención y stream de texto recibido íntegro guardado en TXT compartible; notificación visible cuenta líneas sin mostrar contenido crudo en pantalla bloqueada.
- [ ] Clasifica y filtra eventos de acciones/intents, GMS/satélite, pérdida/conexión/validación Wi‑Fi, DNS, conectividad móvil y redes disponibles/perdidas.
- [ ] La explicación distingue eventos observados de conclusiones sobre origen externo o entrega de datos a una aplicación.

## 4. Análisis opcional de conntrack
- [x] Acepta pegar texto de conntrack proporcionado por el usuario y la IP local del teléfono; el archivo no se lee ni se vigila automáticamente.
- [x] Marca solo candidatos `NEW` con origen global externo y destino/tupla de respuesta consistente con el teléfono; contempla traducción DNAT.
- [x] Advierte que conntrack por sí solo no prueba que una app haya recibido los datos; los registros fuente se incluyen junto a la interpretación.

## 5. Exportación y bugreport
- [ ] Exporta un archivo JSON de sesión transferible con timestamps, snapshots, entradas logcat visibles, resultados de conntrack, códigos de salida y avisos; el logcat íntegro se exporta además como TXT separado.
- [ ] La generación de bugreport es opcional y advierte que puede tardar varios minutos y contener datos sensibles antes de ejecutarse; el ZIP se comparte separadamente si Android lo permite.
- [ ] Los diagnósticos permanecen locales hasta que la persona use explícitamente compartir/exportar.
- [ ] Permite borrar bajo confirmación los archivos privados JSON/TXT/ZIP y el registro visible de la sesión; el APK no accede ni elimina archivos ajenos a NetADB.

## 6. Identidad, avisos y APK
- [x] La app aplica el estilo Terminal Fósforo aprobado y registra un icono de launcher cuadrado y adaptativo coherente con NetADB.
- [x] Los avisos legales de LADB y de las bibliotecas ADB reutilizadas se incluyen dentro de la app y acompañan las redistribuciones.
- [ ] Preparar una build Android release firmada por el flujo administrado; entregar el APK instalable solo cuando la build real termine correctamente, destinado a instalación directa fuera de Google Play.

## 7. Interfaz de terminal inspirada en LADB
- [ ] La pantalla inicial usa la jerarquía de terminal de LADB: barra superior compacta con estado, área de salida monoespaciada desplazable/seleccionable que ocupa el espacio disponible y entrada de comando anclada abajo; el input muestra que espera conexión y permanece deshabilitado hasta que haya shell autorizado.
- [ ] Un catálogo organizado de comandos ADB/Shell frecuentes permite seleccionar un comando y cargarlo en la línea de entrada; la selección no ejecuta el comando, que solo se envía al tocar Enviar.
- [ ] El diálogo de conexión deja introducir el host:puerto de emparejamiento y el código temporal de 6 dígitos, borrar el código después de enviarlo y después aceptar por separado el host:puerto de Wireless debugging.
- [ ] Tras elegir inequívocamente un dispositivo autorizado, la pantalla abre un shell ADB persistente para ese serial; envía los comandos del usuario, agrega el prompt/eco local y muestra las líneas recibidas, errores y estados de cierre en la consola.
- [ ] Las herramientas de diagnóstico existentes permanecen disponibles en una pestaña propia; la pantalla Licencias sigue siendo accesible desde la navegación principal.


## 8. Comparación de snapshots
- [ ] La pantalla de Diagnóstico permite elegir dos snapshots guardados de esta sesión, define cuál es la captura base y cuál la más reciente, y compara archivos/fuentes homólogos sin enviar los datos fuera del dispositivo.
- [ ] El resultado resume por fuente cuántas líneas se añadieron, quitaron o cambiaron y permite revisar las diferencias concretas.
- [ ] Agrupa de forma heurística cambios observados en conectividad, Wi‑Fi, DNS, IP/rutas, telefonía y otros; conserva y muestra errores de captura y advierte que el resumen no prueba una causa raíz.
- [ ] La comparación tolera fuentes ausentes y diferencias entre snapshots que incluyan o no `telephony.registry`; no altera los snapshots originales.

## 9. Gestión de apps del sistema mediante Shizuku
- [ ] La nueva pestaña Apps explica que requiere instalar e iniciar Shizuku, otorgar permiso a NetADB y usar Shizuku con UID ADB/shell 2000; no usa root/Sui para estas acciones y muestra un estado distinto cuando Shizuku no está iniciado, perdió el binder o falta autorización.
- [ ] Desde Shizuku activo, la persona puede listar paquetes del sistema y, opcionalmente, apps de usuario, filtrar por nombre de paquete y ver los paquetes que el sistema informa como deshabilitados.
- [ ] Para un paquete válido, se puede pedir confirmación y luego ejecutar solo detener forzosamente, deshabilitar para el usuario actual o habilitar; la app muestra resultado/error y no ejecuta cambios sin confirmación explícita.
- [ ] La implementación usa la API oficial Shizuku con `UserService` y provider registrado; no usa APIs obsoletas de ejecución de procesos ni interpola texto de usuario en shell.
- [ ] No ofrece desinstalación ni borrado de datos. Bloquea una lista explícita de paquetes esenciales para deshabilitar, explica el riesgo de alterar funciones del fabricante y advierte que el permiso ADB de Shizuku no equivale a root ni garantiza que cada paquete pueda modificarse.
- [ ] La pantalla informa que Shizuku en dispositivos sin root se inicia mediante depuración inalámbrica en Android 11 o posterior y debe iniciarse de nuevo tras cada reinicio, según la guía de Shizuku.


## 10. VPN local consentida con reenvío TCP/UDP
- [ ] Desde NetADB, la persona puede elegir una aplicación instalada e iniciar una captura local; antes de establecer el túnel, NetADB llama a `VpnService.prepare()` y Android muestra su consentimiento del sistema. Si el permiso se deniega o cambia la VPN preparada, la captura no se inicia hasta volver a autorizarla.
- [ ] El `VpnService.Builder` enruta únicamente el paquete seleccionado mediante `addAllowedApplication`; NetADB excluye su propio tráfico del filtro para no crear un bucle. No requiere root ni Shizuku. Si ya hay otra VPN activa, NetADB informa que Android solo permite una VPN activa por usuario/perfil y no la reemplaza silenciosamente.
- [ ] Mientras está activa, la captura conserva conectividad TCP y UDP mediante un motor de reenvío TUN/`tun2socks` y relay local, con relay ligado a loopback. El foreground service muestra una notificación persistente con estado y acción de detener. Detener, revocar permiso o fallar cierra TUN/relays y elimina la ruta VPN.
- [ ] La pantalla muestra conexiones/metadatos disponibles del paquete seleccionado (protocolo, IP/puerto local/remoto, hora y bytes; DNS/SNI solo cuando puedan observarse), sin guardar payload, exportar tráfico por defecto ni descifrar TLS.
- [ ] La interfaz aclara que la VPN sin root observa principalmente conexiones salientes iniciadas por la aplicación; no prueba que una conexión entrante no solicitada haya llegado a una app, y el cifrado TLS no se descifra.
- [ ] Los componentes nativos redistribuidos incluyen los avisos MIT completos de sus proyectos y las licencias de dependencias transitivas exigidas. La implementación seleccionada está pendiente; no se declara disponible hasta compilarse y verificarse en Android real.

## 11. Inspección profunda de app en modo de solo lectura
- [ ] Desde la pestaña Apps, la persona puede abrir una ficha de un paquete y consultar nombre/paquete, versión, UID, target SDK y fechas disponibles, sin modificar la app inspeccionada.
- [ ] La ficha resume permisos declarados/concedidos, activities, services, receivers y providers que Android exponga, y AppOps disponibles; cada bloque indica cuando el sistema no entregó datos en vez de inventarlos.
- [ ] Cuando el sistema lo permita, la ficha muestra estadísticas de red agregadas por UID (bytes recibidos/enviados y periodo disponible), sin alterar la configuración de red ni instalar un VPN.
- [ ] La interfaz distingue expresamente estadísticas por UID de destinos: no asegura mostrar IP, dominio ni sockets activos de la app y explica que Android/Shizuku no expone de forma uniforme esos detalles sin instrumentación adicional.
- [ ] No se añade inyección/hooking de Zygote, Zygisk ni LSPosed; la inspección funciona en modo Shizuku ADB UID 2000, sin root, y es de solo lectura.
