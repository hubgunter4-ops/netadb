# NetADB: estado y proceso de entrega APK

## Estado del código

NetADB conserva la base Expo Router/React Native con NativeWind y el módulo Android Kotlin `netadb-bridge`. La rama incluye el puente ADB local, la terminal, diagnósticos y snapshots, logcat, exportación privada, servicio foreground, comparación de snapshots y una pestaña Apps para Shizuku. La pantalla Licencias expone los avisos de LADB, el ejecutable ADB Apache-2.0, Shizuku API MIT y los avisos de la VPN nativa.

La integración de VPN propia ya está en el código fuente: `NetadbVpnService` solicita el permiso del sistema, filtra con `addAllowedApplication`, ofrece selector de apps, instala una notificación persistente con acción DETENER y crea un túnel local TCP/UDP. Se incluyen Hev SOCKS5 tunnel/server y las dependencias/licencias de terceros; sus revisiones y avisos están en [`THIRD_PARTY_NOTICES.md`](../modules/netadb-bridge/THIRD_PARTY_NOTICES.md). El bridge nativo emite destinos TCP CONNECT y datagramas UDP con protocolo, destino y longitud solamente. No registra contenido de paquetes ni descifra TLS. La UI conserva eventos en memoria durante la sesión y los borra al detenerla.

**La VPN todavía no está validada como función ejecutable:** el Sandbox no tiene Android SDK/NDK, no se ha generado un APK, y no hay una build EAS confirmada. Por tanto, no se afirma que TCP/UDP continúe funcionando en un dispositivo real. También quedan por verificar la integración Shizuku/AIDL, el servicio foreground y la compatibilidad de las bibliotecas JNI/NDK con la build gestionada.

En modo sin root, la VPN observa principalmente conexiones salientes de la app seleccionada. Un CONNECT TCP representa un destino solicitado, no prueba por sí solo que la conexión haya terminado correctamente. El contador total de TUN no equivale necesariamente a bytes entregados por una app remota; los bytes UDP por destino proceden del tamaño de datagramas reenviados. La app no demuestra conexiones entrantes espontáneas ni captura payload. Android mantiene una sola VPN activa por usuario/perfil; NetADB informa el conflicto y no sustituye otra VPN silenciosamente.

## Pendientes de release

1. Ejecutar una build Android real desde Expo/EAS Dashboard para compilar el `externalNativeBuild` y confirmar que las bibliotecas `hev-socks5-tunnel` y `hev-socks5-server` están empaquetadas para `armeabi-v7a` y `arm64-v8a`.
2. Probar en un teléfono Android 11 o posterior consentimiento concedido/denegado, una VPN externa activa, selección de una app, tráfico TCP y UDP, DNS, segundo plano, notificación, parada, revocación y restauración de conectividad. Investigar cualquier fallo JNI/NDK o de manifest antes de distribuir.
3. Verificar Shizuku por ADB/shell UID 2000, inventario, inspección, acciones confirmadas y recuperación al revocar el permiso en un dispositivo real.
4. Ejecutar `pnpm check` y `pnpm test` tras los cambios nativos y corregir regresiones.
5. Guardar la implementación final en el repositorio canónico. Actualizar el espejo público de GitHub cuando los cambios estén estabilizados y exista autorización/acceso al repositorio de destino.
6. Enlazar el proyecto Expo con una cuenta EAS del usuario, confirmar `extra.eas.projectId` y administrar la firma Android en Expo. No se ha iniciado ni validado una build y todavía no existe APK descargable.
7. Esperar el resultado exitoso de Dashboard, descargar el `.apk`, instalarlo en un dispositivo y repetir las pruebas funcionales relevantes antes de llamarlo entrega final.

## Proceso para generar el APK en Expo Dashboard

1. Usa el proyecto Expo correcto. El paquete Android configurado en `app.config.ts` es `space.manus.netadb.t224504891442998`; no lo cambies sin decidir cómo se actualizará una instalación existente.
2. Conserva los perfiles `preview` y `production` de [`eas.json`](../eas.json). Ambos declaran `distribution: internal` y `android.buildType: apk`, configuración destinada a producir un APK instalable directamente y compartible fuera de una tienda ([guía APK](https://docs.expo.dev/build-reference/apk/), [referencia `eas.json`](https://docs.expo.dev/build/eas-json/)).
3. En Expo Dashboard, abre el proyecto, ve a **Builds**, crea una build de **Android** y elige `preview` para pruebas o `production` para la candidata de release. Si el Dashboard solicita vincular el proyecto o configurar el identificador EAS, termina ese paso en la cuenta del usuario y guarda el `projectId` confirmado en `app.config.ts`; todavía no está enlazado en el archivo fuente.
4. En **Credentials**, usa o genera el keystore Android para el paquete configurado. Expo puede administrar la firma. Conserva una copia privada del keystore y sus datos para que futuras actualizaciones mantengan la misma identidad. No subas keystores, contraseñas ni `credentials.json` al repositorio ([credenciales de Expo](https://docs.expo.dev/app-signing/app-credentials/)).
5. Inicia la build y espera a que Dashboard confirme **successful**. Descarga el artefacto `.apk` desde sus detalles. Un commit, un Preview web o una build en curso no demuestran que el APK esté listo.
6. Instala el APK desde el enlace de descarga, autorizando esa fuente si Android lo solicita. Alternativamente, desde una computadora puedes usar `adb install ruta/al/archivo.apk`. Prueba pairing ADB, capturas en segundo plano y VPN consentida TCP/UDP.
7. Distribuye el APK directamente por el canal elegido; NetADB no se publica en Google Play por la restricción de licencia de la arquitectura LADB incorporada.

## Referencias técnicas

- [Android `VpnService`](https://developer.android.com/develop/connectivity/vpn): consentimiento del sistema, TUN, ciclo de vida y VPN activa por usuario/perfil.
- [Hev SOCKS5 tunnel](https://github.com/heiher/hev-socks5-tunnel) y [Hev SOCKS5 server](https://github.com/heiher/hev-socks5-server): código upstream fijado y avisos de licencia en `THIRD_PARTY_NOTICES.md`.
- [Expo: APK](https://docs.expo.dev/build-reference/apk/), [configuración `eas.json`](https://docs.expo.dev/build/eas-json/) y [credenciales](https://docs.expo.dev/app-signing/app-credentials/).
