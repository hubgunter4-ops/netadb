# Resultados NetADB

## 1. Emparejamiento y sesión ADB inalámbrica
- [ ] La app usa Wireless Debugging de Android y un ADB local embebido; solicita `host:puerto` de emparejamiento y código temporal, luego acepta el `host:puerto` de conexión independiente, sin guardar el código en archivos ni registros. Este APK no implementa USB/OTG.
- [ ] La persona autoriza la depuración en Android. La app ofrece conexión y detección de dispositivos, selección inequívoca si hay varios y estados visibles para emparejando, conectado y error.
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
