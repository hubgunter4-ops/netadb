# Revisión de seguridad TLS y ADB

Fecha: 2026-11-08

## Alcance

Se revisaron la configuración Expo/Android, el puente Kotlin `netadb-bridge`, los servicios ADB, Shizuku y VPN, el `FileProvider` y los clientes HTTP de la aplicación. La revisión fue estática; no se generó ni instaló un APK y no se ejecutaron pruebas contra dispositivos Android.

## Cambios aplicados

### Configuración de red Android

Se añadió `plugins/with-network-security-config.ts`, registrado desde `app.config.ts`. Durante `expo prebuild` o una build EAS el plugin:

- Genera `android/app/src/main/res/xml/network_security_config.xml`.
- Enlaza el archivo mediante `android:networkSecurityConfig`.
- Declara `android:usesCleartextTraffic="false"`.
- Mantiene el tráfico HTTP deshabilitado en todas las variantes.
- Permite confiar en certificados instalados por el usuario únicamente mediante `debug-overrides`, por lo que la CA de usuario no se acepta en builds release.

No se añadieron pins de producción porque el repositorio no proporciona un dominio de API ni hashes SHA-256 verificables. No deben colocarse valores de ejemplo como `AAAA...` en una build distribuible.

### ADB

La dirección de pairing ahora se normaliza una vez después de validarla y ese valor normalizado se pasa al proceso ADB. Esto evita que espacios externos aprobados por la validación lleguen como parte del argumento del proceso.

## Hallazgos

### Controles adecuados observados

- Los comandos ADB se ejecutan mediante `ProcessBuilder` con una lista de argumentos; no se pasan por un shell del sistema.
- Los seriales, nombres de paquete, códigos de pairing, buffers de logcat, nombres de exportación y tamaños de archivo tienen validaciones y límites.
- La autodetección mDNS restringe los endpoints resueltos a direcciones locales o loopback; la conexión manual requiere una dirección introducida por la persona y sigue dependiendo de la autenticación de Wireless debugging.
- Shizuku exige UID 2000 y permiso concedido; se rechaza root/Sui y las acciones disponibles están enumeradas.
- La VPN usa `addAllowedApplication`, exige consentimiento de Android y evita reemplazar otra VPN activa.
- El `FileProvider` está `exported=false`, expone únicamente `files-path` y el bridge comprueba que el archivo compartido permanezca dentro del directorio privado de la app.
- Las llamadas HTTP usan `fetch` y no se encontró un `TrustManager` permisivo ni una desactivación explícita de la validación TLS.

### Riesgos o pendientes

1. **Certificate pinning no implementado.** La app depende de la PKI del sistema para sus endpoints HTTPS. Esto suele ser preferible a un pinning frágil, pero no ofrece la defensa adicional contra una CA comprometida. Para implementarlo hacen falta el dominio real de la API, el pin SHA-256 principal, al menos un pin de respaldo y un procedimiento de rotación probado.
2. **Endpoint configurable.** `EXPO_PUBLIC_API_BASE_URL` se incorpora al bundle público. La configuración Android ahora rechaza HTTP claro, pero el pipeline de release debe comprobar que la URL sea HTTPS y que no apunte a un host de desarrollo antes de producir un APK.
3. **Conexión ADB manual amplia por diseño.** La validación permite nombres DNS, IPv4 e IPv6 con puerto. El usuario debe conectar únicamente a la dirección mostrada por Wireless debugging en una red confiable; no se debe convertir esta función en un escáner de hosts ni aceptar endpoints recibidos desde fuentes no confiables.
4. **Datos sensibles en diagnósticos.** Logcat, bugreport, snapshots, dumpsys y estadísticas pueden contener identificadores, nombres de paquetes, redes, celdas o datos de usuario. La app los mantiene en almacenamiento privado, pero la acción de compartir los entrega a otra aplicación elegida por la persona. La documentación y la UI deben conservar esta advertencia.
5. **Pruebas nativas pendientes.** Es necesario ejecutar `expo prebuild`/EAS y verificar el manifiesto fusionado, la existencia del recurso XML, una build debug con una CA de laboratorio y una build release que rechace esa CA. También hay que probar pairing, conexión, cierre del shell, Shizuku y VPN en un dispositivo Android real.

## Plan de verificación

1. Ejecutar `pnpm check`, `pnpm test` y una comprobación de configuración Expo.
2. Generar el proyecto Android mediante el flujo EAS autorizado; no guardar keystores ni credenciales en Git.
3. Confirmar en el manifiesto fusionado `android:networkSecurityConfig="@xml/network_security_config"` y `android:usesCleartextTraffic="false"`.
4. En debug, instalar una CA de laboratorio en un dispositivo de pruebas y confirmar que una petición HTTPS controlada funciona a través del proxy de pruebas.
5. En release, confirmar que la misma CA de usuario no es una raíz de confianza de la app.
6. Probar únicamente en una red y dispositivos autorizados: pairing con código temporal, conexión al endpoint mostrado, selección explícita de serial y ejecución/cierre del shell.
7. Revisar que los artefactos exportados no salgan del almacenamiento privado salvo tras una acción explícita de compartir.

## Nota sobre producción

La configuración de debug no es una forma de desactivar pinning en una aplicación de terceros ni debe copiarse a una variante release. Si se requiere inspección de tráfico, debe hacerse en una build propia de debug y en dispositivos de laboratorio autorizados. Para producción, mantener el transporte HTTPS, no aceptar CAs de usuario y decidir por separado si el modelo de amenazas justifica pinning con rotación y pin de respaldo.
