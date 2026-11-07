# Automatización Expo/EAS

Este proyecto usa GitHub Actions para iniciar builds y publicar EAS Updates:

- `.github/workflows/eas-build.yml`: inicia un build Android `production-apk` cuando hay cambios nativos relevantes en `main`.
- `.github/workflows/eas-build-pr-label.yml`: inicia un build desde el commit del PR cuando se agrega una etiqueta EAS admitida. También permite lanzar un build manual desde la pestaña Actions.
- `.github/workflows/eas-update.yml`: publica un EAS Update en el canal `preview` cuando cambian pantallas, componentes o lógica JavaScript/TypeScript.

El proyecto EAS está vinculado al project ID `30c1641a-11cb-4912-8fcf-b1f7700892b6`. Los perfiles `development`, `preview`, `production` y `production-apk` están definidos en `eas.json`. `production-apk` hereda la configuración Android de `production`; todos generan APKs con la imagen `sdk-57`, alineada con Expo SDK 57.

## Builds desde etiquetas de PR

Agrega una etiqueta con el formato `eas-build-android[:<perfil>]`:

- `eas-build-android:preview`: APK Android del perfil `preview`.
- `eas-build-android`: usa el perfil `production-apk` por defecto.

El workflow compila únicamente Android. El perfil debe existir en `eas.json` y tener configuración Android; de lo contrario, el workflow falla antes de solicitar el build. El build parte del commit más reciente del PR. Para builds manuales, usa **Actions → Expo EAS Android Build from PR label → Run workflow** y selecciona el perfil.

## Secreto requerido

En GitHub abre **Settings → Secrets and variables → Actions → New repository secret** y crea:

- **Name:** `EXPO_TOKEN`
- **Secret:** un token personal creado en <https://expo.dev/settings/access-tokens>

El token debe tener acceso al proyecto EAS para iniciar builds y publicar Updates. Nunca lo agregues al código, a `.env`, a un commit ni a los logs.

El workflow usa el evento `pull_request` y no `pull_request_target`, y no expone el token durante la instalación de dependencias. Aun así, iniciar un build evalúa la configuración del proyecto del PR, por lo que agrega una etiqueta de build solo después de revisar y confiar en ese código. Por la política de GitHub, los secrets no están disponibles en PRs de forks; para compilar contribuciones externas, configura la integración oficial de Expo GitHub App o ejecuta el build desde una rama de confianza.

## Canales y distribución

El perfil EAS `preview` usa el canal `preview`. Los builds instalados con ese perfil recibirán Updates publicados por `eas-update.yml` cuando reinicien la aplicación. Los cambios nativos no se distribuyen por OTA; requieren instalar un nuevo APK. El módulo `modules/netadb-bridge` declara únicamente la plataforma Android.
