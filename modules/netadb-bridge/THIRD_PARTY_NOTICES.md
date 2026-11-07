# Avisos de terceros

## LADB

La arquitectura local de ADB toma como referencia [tytydraco/LADB](https://github.com/tytydraco/ladb). Se inspeccionó el commit upstream `60f48029cf9d8e0bc848ca41a7bd76694d4ab796`, citado también por la página de releases compartida por el usuario: [Jobians/ladb-apk-download/releases](https://github.com/Jobians/ladb-apk-download/releases). La documentación de LADB describe un servidor ADB integrado en bibliotecas de la aplicación que se comunica con Wireless debugging del mismo Android.

La licencia de LADB requiere conservar el aviso de copyright, sus condiciones y la exención de garantías al redistribuir fuente o binario. También prohíbe subir este software a Google Play por cualquier persona distinta de su desarrollador original. Por esa razón esta app se prepara para instalación directa y no se publica en Play Store. El texto completo se distribuye en `LADB-LICENSE.txt` y se incorpora como recurso consultable desde la app.

## Ejecutable ADB incluido

Los ejecutables nativos `libadb.so` de ARM64, ARMv7, x86 y x86_64 provienen del árbol `app/src/main/jniLibs/` del repositorio upstream indicado. Se incluyen en `android/src/main/jniLibs/` para que el APK no dependa de un ADB instalado externamente. Su archivo `LICENSE` declara Apache License 2.0; la copia completa está en `ADB-LIBRARY-LICENSE.txt` y dentro de los recursos del APK.

## Shizuku API

El SDK API/provider se integra desde Maven Central (`dev.rikka.shizuku:api` y `dev.rikka.shizuku:provider`, versión 13.1.5) para enlazar un UserService AIDL. El proyecto upstream está en [RikkaApps/Shizuku-API](https://github.com/RikkaApps/Shizuku-API). La API usa licencia MIT; el aviso completo está en `android/src/main/res/raw/shizuku_api_license.txt` y se muestra en la pestaña Licencias del APK.

## VPN local: Hev SOCKS5 tunnel y server

NetADB incluye código del [Hev SOCKS5 tunnel](https://github.com/heiher/hev-socks5-tunnel), fijado en commit `1711a443d72d89679c0a2044f36085358a101bc4`, y del [Hev SOCKS5 server](https://github.com/heiher/hev-socks5-server), fijado en commit `d23aaad702eb532ddb7c03be4598ed6f79cb79c1`. Las copias de origen están en `android/src/main/jni/hev-socks5-tunnel/` y `android/src/main/jni/hev-socks5-server/`. Se integran como bibliotecas nativas en el Android Module.

Submódulos fijados del túnel: core `d12ec5962cbb777e087015db6aa73374014dd82e`, `hev-task-system` `83196e8286c07e9eb174505eea4d076a6503ab48`, lwIP `e274b3bea0877611773b5869a63c737ef231e841` y libyaml `7e2ecb0e67995d424b35e436f846078d37904b4e`. Submódulos fijados del server: core `b43fa857fb39c854da01d13bc55eded66b4f4a3b`, `hev-task-system` `ded55c412b3951bc7decb5cb3b9135701e762998` y libyaml `0c82efd10dc67b9e7f159d2c7f5d1dc3c1b5bc11`.

Los proyectos Hev y sus componentes correspondientes conservan sus licencias MIT y BSD; los makefiles Android upstream contienen además avisos Apache License 2.0. Se mantienen los textos completos en `android/src/main/res/raw/vpn_engine_licenses.txt` y `licenses/Apache-2.0.txt`, y se muestran en la pantalla Licencias. Las modificaciones NetADB se limitan al wrapper JNI, el lifecycle del servicio VPN y callbacks de metadatos TCP/UDP. No se guarda contenido de paquetes ni se descifra TLS.
