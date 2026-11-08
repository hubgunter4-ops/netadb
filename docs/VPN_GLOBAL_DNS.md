# VPN global y política DNS

## Modo global

El servicio admite dos alcances:

- `application`: conserva `addAllowedApplication(packageName)`.
- `global`: no llama a `addAllowedApplication()`, por lo que Android permite el tráfico de todas las aplicaciones, y excluye NetADB con `addDisallowedApplication(packageName)`.

La parte central de `NetadbVpnService` es:

```kotlin
val builder = Builder()
    .setSession("NetADB · captura global")
    .setMtu(TUN_MTU)
    .setBlocking(false)
    .addAddress(TUN_IPV4_ADDRESS, 32)
    .addRoute("0.0.0.0", 0)
    .addAddress(TUN_IPV6_ADDRESS, 128)
    .addRoute("::", 0)

// Sin addAllowedApplication(), todas las apps usan el VPN.
// NetADB se excluye para evitar que sus conexiones entren en su propio TUN.
builder.addDisallowedApplication(packageName)

tunnelFd = builder.establish()
```

En esta implementación, `scope` se valida como `application` o `global`. En modo global no se requiere una aplicación objetivo; el paquete de NetADB se usa como exclusión.

## Bridge Expo

La función nativa ahora recibe el alcance y una lista de dominios normalizados:

```kotlin
AsyncFunction("startVpnCapture") {
    scope: String,
    targetPackage: String,
    blockedDomains: List<String> ->
    require(scope in setOf("application", "global"))
    if (scope == "application") {
        require(targetPackage.matches(Regex("[A-Za-z0-9_]+(\\\\.[A-Za-z0-9_]+)+")))
    }
    NetadbVpnService.start(context, scope, targetPackage, blockedDomains)
    true
}
```

La pantalla VPN conserva el modo por aplicación, añade `TODAS LAS APPS` y envía los dominios introducidos al servicio. Las llamadas antiguas desde la pestaña Apps se adaptaron para continuar usando el modo `application`.

## Estado de DNS y filtrado

La lista `blockedDomains` ya viaja desde React Native hasta `NetadbVpnService`, se normaliza y queda expuesta en el estado de la VPN. Sin embargo, **el motor Hev incluido todavía no consulta esa lista para descartar paquetes**. Por tanto, en esta revisión la lista es configuración preparada, no un bloqueo efectivo.

Para completar la opción de bloqueo por dominio e IP resuelta se necesita una segunda fase nativa:

1. Leer y responder consultas DNS UDP/53 y TCP/53 desde los paquetes del TUN.
2. Reenviar consultas al resolver ascendente usando sockets protegidos con `VpnService.protect()`.
3. Devolver `NXDOMAIN` o `REFUSED` para dominios bloqueados.
4. Parsear registros `A` y `AAAA`, guardar cada IP con su TTL y aplicar la lista de dominios e IPs al flujo posterior.
5. Añadir un callback C/JNI de decisión antes de abrir conexiones, con límites de tamaño, TTL, expiración y limpieza al detener la VPN.

No se debe mostrar el filtro como activo hasta implementar ese callback. DNS-over-TLS y DNS-over-HTTPS tampoco serán visibles como nombres en un parser UDP/53; la app no debe prometer inspección de esos protocolos.

## Verificación realizada

- `pnpm check`: correcto.
- `pnpm test`: 35 tests correctos y 1 omitido.
- Se validó el contrato TypeScript para modo `application`/`global`.
- No se ejecutó una build Android nativa ni se probó en dispositivo; la compilación EAS y la prueba real del TUN siguen pendientes.
