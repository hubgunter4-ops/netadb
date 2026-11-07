# Automatización Expo/EAS

Este proyecto usa dos workflows en GitHub Actions:

- `.github/workflows/eas-update.yml`: publica un EAS Update en el canal `preview` cuando cambian pantallas, componentes o lógica JavaScript/TypeScript.
- `.github/workflows/eas-build.yml`: inicia un build Android `preview` cuando cambian módulos nativos, `libadb.so`, `app.config.ts`, dependencias, assets o `eas.json`.

El proyecto EAS está vinculado a la cuenta `0s0xpl` con project ID `30c1641a-11cb-4912-8fcf-b1f7700892b6`.

## Secreto requerido

En GitHub abre:

`Settings → Secrets and variables → Actions → New repository secret`

Crea un secreto con:

- **Name:** `EXPO_TOKEN`
- **Secret:** un token personal creado en <https://expo.dev/settings/access-tokens>

El token debe poder publicar EAS Updates e iniciar EAS Builds. Nunca lo agregues al código, a `.env`, a un commit ni a los logs.

## Canales

El perfil EAS `preview` usa el canal `preview`. Los builds instalados con ese perfil recibirán updates publicados por `eas-update.yml` cuando reinicien la aplicación. Los cambios nativos no se distribuyen por OTA; disparan `eas-build.yml` y requieren instalar el nuevo APK.
