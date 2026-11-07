# NetADB: estado y proceso de entrega APK

## Estado del código

NetADB tiene una base Expo Router/React Native con NativeWind y un módulo Android Kotlin `netadb-bridge`. La rama actual incorpora el puente ADB local, terminal, diagnósticos/snapshots, logcat, exportación privada y servicio foreground; también contiene la comparación local de snapshots y una pestaña de gestión/inspección Shizuku. La pantalla Licencias expone los avisos de LADB, el ejecutable ADB Apache-2.0 y Shizuku API MIT.

La implementación de VPN propia **no está terminada** en este punto. La persona eligió implementar el `VpnService` dentro de NetADB, en lugar de depender de PCAPdroid. El diseño requiere pedir autorización con el diálogo de Android, limitar el túnel a una app elegida y mantener su conectividad mediante reenvío TCP/UDP. La investigación identificó [hev-socks5-tunnel](https://github.com/heiher/hev-socks5-tunnel) y [hev-socks5-server](https://github.com/heiher/hev-socks5-server) como candidatos MIT para el motor y relay local. No están todavía incorporados ni licenciados dentro del APK; antes de redistribuirlos habrá que integrar sus fuentes/NDK y avisos transitivos.

La captura propuesta es de metadatos de conexión, sin guardar payload y sin descifrar TLS. En modo sin root se observarán principalmente conexiones salientes iniciadas por la app filtrada; eso no prueba que una conexión entrante no solicitada haya llegado a una app. Android permite una VPN activa por usuario/perfil, por lo que NetADB debe informar un conflicto y no sustituir otra VPN sin conocimiento de la persona.

## Pendientes desde este commit

1. Implementar y enlazar el `VpnService` Android y el flujo de autorización `VpnService.prepare()` desde NetADB.
2. Integrar un motor TUN/`tun2socks` y relay TCP/UDP local, con filtrado por paquete, controles de ciclo de vida y parada segura para que no quede una ruta VPN activa si falla el motor.
3. Crear la interfaz de selección de app, estado de captura, lista de conexiones y botón de parada. Mantener los datos locales y limitar la vista a metadatos.
4. Incorporar los avisos MIT y licencias transitivas de cualquier fuente que finalmente se redistribuya; ampliar la pantalla Licencias en el APK.
5. Validar el módulo Android en un dispositivo Android 11 o posterior: consentimiento, permiso denegado, conectividad TCP/UDP, otra VPN activa, captura en segundo plano, notificación, parada/revocación y recuperación de red.
6. Revisar el comportamiento de Shizuku/AIDL y las operaciones de inspección en un dispositivo Android real. Las comprobaciones JavaScript no sustituyen la validación del código nativo.
7. Ejecutar `pnpm check` y `pnpm test` después de los cambios, corregir fallos y guardar el estado final en el repositorio canónico. Actualizar el espejo público de GitHub una vez que los cambios nativos estén estabilizados.
8. Enlazar este proyecto a un proyecto Expo/EAS del usuario, confirmar `extra.eas.projectId` y la credencial de firma Android administrada. `eas.json` ya prepara los perfiles `preview` y `production` para APK interno; todavía no se ha iniciado ni validado una build y no hay APK para descargar.
9. Lanzar la build desde el Dashboard, esperar resultado exitoso, descargar el `.apk` y probar instalación/arranque y las funciones nativas antes de anunciarlo como entrega final.

## Proceso para generar el APK en Expo Dashboard

1. Asegúrate de que el código que se va a compilar está guardado en el proyecto Expo correcto y que el Dashboard lo reconoce. El paquete Android configurado en `app.config.ts` es `space.manus.netadb.t224504891442998`; no lo cambies sin decidir cómo se actualizará una instalación existente.
2. Conserva los perfiles de `eas.json`: `preview` y `production` declaran `distribution: internal` y `android.buildType: apk`. Expo documenta que `android.buildType: "apk"` genera un APK instalable directamente y que la distribución interna produce una build para compartir/instalar fuera de una tienda ([guía APK](https://docs.expo.dev/build-reference/apk/), [referencia eas.json](https://docs.expo.dev/build/eas-json/)).
3. En el Dashboard de Expo, abre el proyecto, ve a **Builds**, crea una build de **Android** y selecciona el perfil `preview` para pruebas o `production` para la candidata de release. Si Expo pide vincular el proyecto o configurar el identificador EAS, termina ese paso en la cuenta del usuario y guarda el `projectId` correcto en `app.config.ts`; este identificador aún debe confirmarse.
4. En **Credentials** del proyecto, usa o genera el keystore Android para el paquete configurado. Expo puede administrar la firma; conserva una copia privada y segura del keystore y sus datos para que futuras actualizaciones mantengan la misma identidad. No subas keystores, contraseñas ni `credentials.json` al repositorio ([credenciales de Expo](https://docs.expo.dev/app-signing/app-credentials/)).
5. Inicia la build y espera a que el Dashboard confirme **successful**. Descarga el artefacto `.apk` desde su página de detalles. Un commit, un Preview web o una build aún ejecutándose no son evidencia de que el APK esté listo.
6. Instala en un dispositivo de prueba desde el enlace de descarga, autorizando la instalación desde esa fuente si Android lo solicita. También puede instalarse desde una computadora con `adb install ruta/al/archivo.apk`. Prueba pairing ADB, captura de segundo plano y, cuando se implemente, VPN consentida/reenviado TCP-UDP.
7. Distribuye el APK directamente por el canal elegido; NetADB mantiene la restricción de no publicarse en Google Play debido a los avisos de la arquitectura LADB incorporada.

## Referencias técnicas

- [Android `VpnService`](https://developer.android.com/develop/connectivity/vpn): autorización del sistema, TUN, ciclo de vida, foreground service y límite de una VPN activa por usuario/perfil.
- [Expo: generar APK](https://docs.expo.dev/build-reference/apk/), [configuración `eas.json`](https://docs.expo.dev/build/eas-json/) y [credenciales de apps](https://docs.expo.dev/app-signing/app-credentials/).
- [HevSocks5Tunnel](https://github.com/heiher/hev-socks5-tunnel) y [HevSocks5Server](https://github.com/heiher/hev-socks5-server): proyectos candidatos; todavía no forman parte del APK NetADB.
