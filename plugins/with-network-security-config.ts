import {
  withAndroidManifest,
  withDangerousMod,
  type ConfigPlugin,
} from "expo/config-plugins";
import fs from "node:fs/promises";
import path from "node:path";

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Nunca permitir HTTP sin cifrar. -->
    <base-config cleartextTrafficPermitted="false" />

    <!-- Solo las variantes debug pueden confiar en una CA instalada por el usuario. -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
            <certificates src="system" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`;

const withNetworkSecurityConfig: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        "No se encontró la etiqueta <application> en AndroidManifest.xml",
      );
    }

    application.$ = application.$ ?? {};
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    application.$["android:usesCleartextTraffic"] = "false";
    return manifestConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (dangerousConfig) => {
      const xmlDirectory = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      await fs.mkdir(xmlDirectory, { recursive: true });
      await fs.writeFile(
        path.join(xmlDirectory, "network_security_config.xml"),
        NETWORK_SECURITY_CONFIG,
        "utf8",
      );
      return dangerousConfig;
    },
  ]);
};

export default withNetworkSecurityConfig;
