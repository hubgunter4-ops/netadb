# Avisos de terceros

## LADB

La arquitectura local de ADB toma como referencia [tytydraco/LADB](https://github.com/tytydraco/ladb). Se inspeccionó el commit upstream `60f48029cf9d8e0bc848ca41a7bd76694d4ab796`, citado también por la página de releases compartida por el usuario: [Jobians/ladb-apk-download/releases](https://github.com/Jobians/ladb-apk-download/releases). La documentación de LADB describe un servidor ADB integrado en bibliotecas de la aplicación que se comunica con Wireless debugging del mismo Android.

La licencia de LADB requiere conservar el aviso de copyright, sus condiciones y la exención de garantías al redistribuir fuente o binario. También prohíbe subir este software a Google Play por cualquier persona distinta de su desarrollador original. Por esa razón esta app se prepara para instalación directa y no se publica en Play Store. El texto completo se distribuye en `LADB-LICENSE.txt` y se incorpora como recurso consultable desde la app.

## Ejecutable ADB incluido

Los ejecutables nativos `libadb.so` de ARM64 y ARMv7 provienen del árbol `app/src/main/jniLibs/` del repositorio upstream indicado. Su archivo `LICENSE` declara Apache License 2.0; la copia completa está en `ADB-LIBRARY-LICENSE.txt` y dentro de los recursos del APK.

## Shizuku API

El SDK API/provider se integra desde Maven Central (`dev.rikka.shizuku:api` y `dev.rikka.shizuku:provider`, versión 13.1.5) para enlazar un UserService AIDL. El proyecto upstream está en [RikkaApps/Shizuku-API](https://github.com/RikkaApps/Shizuku-API). La API usa licencia MIT; el aviso completo está en `android/src/main/res/raw/shizuku_api_license.txt` y se muestra en la pestaña Licencias del APK.
