import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NetadbBridge, type BridgeStatus } from "@/modules/netadb-bridge";

const C = {
  background: "#0b100d",
  panel: "#121a15",
  border: "#26382b",
  text: "#e5f1e7",
  muted: "#83958a",
  green: "#83ff70",
  amber: "#ffc15c",
  red: "#ff7777",
};
const MAX_SCROLLBACK_CHARS = 16_384;
const QUICK_COMMANDS = [
  { group: "DISPOSITIVO", title: "Versión de Android", command: "getprop ro.build.version.release", note: "Versión comercial del sistema." },
  { group: "DISPOSITIVO", title: "Nivel de API", command: "getprop ro.build.version.sdk", note: "Nivel de API Android del dispositivo." },
  { group: "DISPOSITIVO", title: "Usuario del shell", command: "id", note: "Confirma con qué usuario ejecuta ADB Shell." },
  { group: "RED", title: "Interfaces y direcciones", command: "ip addr", note: "Muestra las interfaces de red visibles para el shell." },
  { group: "RED", title: "Rutas IP", command: "ip route", note: "Consulta la tabla de rutas IPv4." },
  { group: "RED", title: "Conectividad Android", command: "dumpsys connectivity", note: "Estado de redes y conectividad del sistema." },
  { group: "RED", title: "Estado Wi-Fi", command: "dumpsys wifi", note: "Detalles de Wi-Fi; puede incluir identificadores de red." },
  { group: "APLICACIONES", title: "Paquetes de usuario", command: "pm list packages -3", note: "Lista apps de terceros instaladas en el teléfono." },
  { group: "REGISTROS", title: "Últimas 100 líneas de logcat", command: "logcat -d -t 100", note: "Puede mostrar datos personales o identificadores presentes en los logs." },
];

type SessionState = "offline" | "connecting" | "choose-device" | "ready" | "error";

function addBoundedLine(previous: string[], incoming: string): string[] {
  const next = [...previous, incoming];
  let total = next.reduce((sum, line) => sum + line.length + 1, 0);

  while (total > MAX_SCROLLBACK_CHARS && next.length > 1) {
    total -= next.shift()!.length + 1;
  }
  if (next.length === 1 && next[0].length > MAX_SCROLLBACK_CHARS) {
    next[0] = next[0].slice(-MAX_SCROLLBACK_CHARS);
  }
  return next;
}

export default function TerminalScreen() {
  const [modalVisible, setModalVisible] = useState(false);
  const [commandsVisible, setCommandsVisible] = useState(false);
  const [pairAddress, setPairAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [automaticPairingCode, setAutomaticPairingCode] = useState("");
  const [connectAddress, setConnectAddress] = useState("");
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);
  const [serial, setSerial] = useState("");
  const [sessionState, setSessionState] = useState<SessionState>("offline");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([
    "NetADB · ADB shell",
    "Empareja y conecta un dispositivo para iniciar una sesión.",
  ]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const terminalScroll = useRef<ScrollView>(null);
  const commandInput = useRef<TextInput>(null);
  const activeShellSerial = useRef("");

  const appendLine = useCallback((line: string) => {
    setTerminalLines((previous) => addBoundedLine(previous, line));
  }, []);

  useEffect(() => {
    if (!NetadbBridge) return;
    let active = true;

    void NetadbBridge.isAvailable()
      .then((status) => {
        if (!active) return;
        setBridgeStatus(status);
        if (status.apiLevel < 30) {
          setNotice("Wireless debugging requiere Android 11 o posterior (API 30+).");
        } else if (!status.available) {
          setNotice("No se encontró el ejecutable ADB incluido en el APK.");
        } else {
          setNotice("Puente ADB listo. Activa Wireless debugging en el dispositivo objetivo.");
        }
      })
      .catch((error) => {
        if (active) setNotice(`No se pudo comprobar el puente ADB: ${String(error)}`);
      });

    const lineSubscription = NetadbBridge.addListener("onShellLine", ({ line, serial: eventSerial }) => {
      if (eventSerial !== activeShellSerial.current) return;
      appendLine(line ?? "");
    });
    const stateSubscription = NetadbBridge.addListener("onShellState", (event) => {
      if (event.serial !== activeShellSerial.current) return;
      if (event.state === "ready") {
        setSessionState("ready");
        setNotice(`Shell activo · ${event.serial}`);
      } else {
        activeShellSerial.current = "";
        setSessionState(event.state === "error" ? "error" : "offline");
        setNotice(
          event.message ||
            (event.state === "closed"
              ? `El shell ${event.serial} se cerró${event.exitCode === undefined ? "." : ` (código ${event.exitCode}).`}`
              : "Error en la sesión de shell."),
        );
      }
    });

    return () => {
      active = false;
      lineSubscription.remove();
      stateSubscription.remove();
    };
  }, [appendLine]);

  useEffect(() => {
    terminalScroll.current?.scrollToEnd({ animated: true });
  }, [terminalLines]);

  const bridgeReady =
    Platform.OS === "android" &&
    bridgeStatus?.available === true &&
    bridgeStatus.apiLevel >= 30;

  const closeDialog = () => {
    setModalVisible(false);
    setPairingCode("");
  };

  const openShell = async (deviceSerial: string) => {
    if (!NetadbBridge || !deviceSerial) return;
    activeShellSerial.current = deviceSerial;
    setSerial(deviceSerial);
    setSessionState("connecting");
    setNotice(`Abriendo shell persistente · ${deviceSerial}`);
    appendLine(`$ adb -s ${deviceSerial} shell`);

    try {
      const result = await NetadbBridge.openShell(deviceSerial);
      if (result.output) appendLine(result.output);
      if (result.ready) {
        setSessionState("ready");
        setNotice(`Shell listo · ${result.serial || deviceSerial}`);
      } else {
        activeShellSerial.current = "";
        setSessionState("error");
        setNotice("No se pudo iniciar el shell ADB en el dispositivo seleccionado.");
      }
    } catch (error) {
      activeShellSerial.current = "";
      setSessionState("error");
      setNotice(`No se pudo abrir el shell: ${String(error)}`);
      appendLine(`! Error al abrir shell: ${String(error)}`);
    }
  };

  const pairDevice = async () => {
    if (!NetadbBridge) {
      setNotice("El emparejamiento requiere la app Android instalada; no está disponible en web.");
      return;
    }
    if (!pairAddress.trim().includes(":") || !/^\d{6}$/.test(pairingCode)) {
      setNotice("Introduce el host:puerto de pairing y el código temporal de 6 dígitos.");
      return;
    }

    const oneTimeCode = pairingCode;
    setPairingCode("");
    setBusy(true);
    setNotice("Enviando el código temporal de pairing…");
    appendLine(`$ adb pair ${pairAddress.trim()}`);

    try {
      const result = await NetadbBridge.pair(pairAddress.trim(), oneTimeCode);
      if (result.output) result.output.trimEnd().split(/\r?\n/).forEach(appendLine);
      setNotice(
        result.success
          ? "Pairing completado. Usa el host:puerto de Wireless debugging para conectar."
          : `Pairing no completado. ${result.output || "Revisa el código y el puerto."}`,
      );
    } catch (error) {
      setNotice(`Error de pairing: ${String(error)}`);
      appendLine(`! Error de pairing: ${String(error)}`);
    } finally {
      setPairingCode("");
      setBusy(false);
    }
  };

  const pairAutomatically = async () => {
    if (!NetadbBridge) return;
    if (!/^\d{6}$/.test(automaticPairingCode)) {
      setNotice("Introduce únicamente el código temporal de 6 dígitos.");
      return;
    }
    setBusy(true);
    setSessionState("connecting");
    setNotice("Buscando Wireless debugging local y enviando el código…");
    appendLine("$ adb pair <servicio local descubierto>");
    try {
      const paired = await NetadbBridge.pairAutomatically(automaticPairingCode);
      if (paired.output) paired.output.trimEnd().split(/\r?\n/).forEach(appendLine);
      setAutomaticPairingCode("");
      if (!paired.success) {
        setSessionState("error");
        setNotice(`No se completó el pairing. ${paired.output || "Revisa que la pantalla de pairing siga abierta."}`);
        return;
      }
      setNotice("Pairing completado. Descubriendo el endpoint ADB…");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const connected = await NetadbBridge.connectAutomatically();
      const devices = connected.connected ? connected.devices ?? [] : [];
      setAvailableDevices(devices);
      if (connected.output) connected.output.trimEnd().split(/\r?\n/).forEach(appendLine);
      if (devices.length === 1) {
        closeDialog();
        await openShell(devices[0]);
      } else if (devices.length > 1) {
        closeDialog();
        setSessionState("choose-device");
        setNotice(`Conexión lista. Selecciona el serial al que abrir el shell (${devices.length} dispositivos).`);
      } else {
        setSessionState("error");
        setNotice(`Pairing correcto, pero no se encontró el endpoint de conexión. ${connected.output || "Usa el modo manual."}`);
      }
    } catch (error) {
      setSessionState("error");
      setNotice(`No se pudo descubrir el teléfono automáticamente: ${String(error)}`);
      appendLine(`! Descubrimiento ADB: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const connectDevice = async () => {
    if (!NetadbBridge) {
      setNotice("La terminal ADB requiere el APK Android; no está disponible en web.");
      return;
    }
    if (!connectAddress.trim().includes(":")) {
      setNotice("Introduce el host:puerto ADB de Wireless debugging.");
      return;
    }

    const endpoint = connectAddress.trim();
    const previousShell = activeShellSerial.current;
    activeShellSerial.current = "";
    setSerial("");
    setAvailableDevices([]);
    if (previousShell) {
      try { await NetadbBridge.closeShell(); } catch { /* El nuevo intento puede continuar. */ }
    }
    setBusy(true);
    setSessionState("connecting");
    setNotice("Conectando al endpoint ADB…");
    appendLine(`$ adb connect ${endpoint}`);

    try {
      const result = await NetadbBridge.connect(endpoint);
      if (result.output) result.output.trimEnd().split(/\r?\n/).forEach(appendLine);
      const devices = result.connected ? result.devices ?? [] : [];
      setAvailableDevices(devices);
      setSerial("");

      if (!result.connected) {
        setSessionState("error");
        setNotice(`No se pudo conectar a ${endpoint}. ${result.output || ""}`);
      } else if (devices.length === 0) {
        setSessionState("offline");
        setNotice("ADB aceptó la conexión, pero no aparece un dispositivo autorizado.");
      } else if (devices.length === 1) {
        closeDialog();
        await openShell(devices[0]);
      } else {
        closeDialog();
        setSessionState("choose-device");
        setNotice(`Conexión lista. Selecciona el serial al que abrir el shell (${devices.length} dispositivos).`);
      }
    } catch (error) {
      setSessionState("error");
      setNotice(`Error de conexión: ${String(error)}`);
      appendLine(`! Error de conexión: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async () => {
    const text = command.trim();
    if (!text || sessionState !== "ready" || !NetadbBridge) return;

    setCommand("");
    appendLine(`› ${text}`);
    try {
      const sent = await NetadbBridge.sendShellCommand(text);
      if (!sent) {
        setNotice("El comando no se pudo enviar; el shell quizá se cerró.");
        activeShellSerial.current = "";
        setSessionState("offline");
      }
    } catch (error) {
      setNotice(`Error enviando el comando: ${String(error)}`);
      appendLine(`! Error enviando comando: ${String(error)}`);
    }
  };

  const closeShell = async () => {
    activeShellSerial.current = "";
    if (NetadbBridge && sessionState === "ready") {
      try {
        await NetadbBridge.closeShell();
      } catch (error) {
        setNotice(`Error cerrando shell: ${String(error)}`);
      }
    }
    appendLine("# Shell cerrado por el usuario.");
    setSessionState("offline");
    setSerial("");
    setAvailableDevices([]);
  };

  const clearTerminal = () => {
    setTerminalLines([]);
    setNotice("Salida de terminal borrada.");
  };

  const selectQuickCommand = (value: string) => {
    setCommand(value);
    setCommandsVisible(false);
    requestAnimationFrame(() => commandInput.current?.focus());
  };

  const statusText = !NetadbBridge
    ? "REQUIERE APK ANDROID"
    : bridgeStatus === null
      ? "COMPROBANDO ADB"
      : bridgeStatus.apiLevel < 30
        ? "ANDROID 11+ REQUERIDO"
        : !bridgeStatus.available
          ? "ADB NO DISPONIBLE"
          : sessionState === "ready"
            ? "SHELL READY"
            : sessionState === "connecting"
              ? "CONECTANDO"
              : sessionState === "choose-device"
                ? "ELIGE DISPOSITIVO"
                : sessionState === "error"
                  ? "ERROR"
                  : "DESCONECTADO";
  const statusColor =
    sessionState === "ready"
      ? C.green
      : sessionState === "error" || (bridgeStatus !== null && !bridgeReady && Platform.OS === "android")
        ? C.red
        : C.amber;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={C.background} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}>
              <Text style={styles.brandGlyph}>›_</Text>
            </View>
            <View>
              <Text style={styles.kicker}>NETADB / WIRELESS ADB</Text>
              <Text style={styles.title}>Terminal</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Emparejar o conectar un dispositivo"
            onPress={() => {
              setNotice("");
              setModalVisible(true);
            }}
            style={styles.connectButton}
          >
            <Text style={styles.connectButtonText}>＋ CONECTAR</Text>
          </Pressable>
        </View>

        <View style={styles.statusBar}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusText}</Text>
          <Text numberOfLines={1} style={styles.serialLabel}>
            {serial || (bridgeReady ? "SIN DISPOSITIVO" : "")}
          </Text>
          {sessionState === "ready" ? (
            <Pressable accessibilityRole="button" onPress={() => void closeShell()} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>CERRAR</Text>
            </Pressable>
          ) : null}
        </View>

        {notice ? (
          <View style={[styles.notice, sessionState === "error" && styles.noticeError]}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
        {!NetadbBridge ? (
          <View style={styles.previewNotice}>
            <Text style={styles.previewNoticeText}>Para usar pairing y shell, instala el APK Android: el puente nativo no se ejecuta en la vista previa web.</Text>
          </View>
        ) : null}

        {availableDevices.length > 1 ? (
          <View style={styles.deviceList}>
            <Text style={styles.deviceListTitle}>SELECCIONA UN DISPOSITIVO AUTORIZADO</Text>
            {availableDevices.map((device) => (
              <Pressable key={device} accessibilityRole="button" onPress={() => void openShell(device)} style={styles.deviceRow}>
                <Text style={styles.deviceSerial}>{device}</Text>
                <Text style={styles.deviceOpen}>ABRIR SHELL →</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <ScrollView
          ref={terminalScroll}
          style={styles.console}
          contentContainerStyle={styles.consoleContent}
          onContentSizeChange={() => terminalScroll.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          {terminalLines.length === 0 ? (
            <Text style={styles.placeholder}>Waiting for connection…</Text>
          ) : (
            terminalLines.map((line, index) => (
              <Text selectable key={`${index}-${line}`} style={styles.outputLine}>
                {line || " "}
              </Text>
            ))
          )}
          {sessionState === "connecting" ? <ActivityIndicator color={C.green} style={styles.spinner} /> : null}
        </ScrollView>

        <View style={styles.commandBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir comandos ADB frecuentes"
            onPress={() => setCommandsVisible(true)}
            style={styles.catalogButton}
          >
            <Text style={styles.catalogButtonText}>CMD</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Limpiar consola" onPress={clearTerminal} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>⌫</Text>
          </Pressable>
          <TextInput
            ref={commandInput}
            value={command}
            onChangeText={setCommand}
            editable={sessionState === "ready"}
            placeholder={sessionState === "ready" ? "Escribe un comando…" : "Waiting for connection…"}
            placeholderTextColor="#69796e"
            style={styles.commandInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => void sendCommand()}
            selectionColor={C.green}
            accessibilityLabel="Comando de shell ADB"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar comando al shell ADB"
            disabled={sessionState !== "ready" || !command.trim()}
            onPress={() => void sendCommand()}
            style={[styles.sendButton, (sessionState !== "ready" || !command.trim()) && styles.disabled]}
          >
            <Text style={styles.sendButtonText}>ENVIAR</Text>
          </Pressable>
        </View>

        <Modal visible={modalVisible} animationType="slide" transparent statusBarTranslucent onRequestClose={closeDialog}>
          <KeyboardAvoidingView style={styles.scrim} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={styles.dialogScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.dialog}>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>Conectar dispositivo</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Cerrar diálogo" onPress={closeDialog}>
                    <Text style={styles.dialogClose}>×</Text>
                  </Pressable>
                </View>
                <Text style={styles.dialogCopy}>
                  Abre “Pair using pairing code” en Depuración inalámbrica. El modo automático descubre el servicio local y solo solicita el código de seis dígitos.
                </Text>

                <Text style={styles.fieldLabel}>MODO AUTOMÁTICO · SOLO CÓDIGO</Text>
                <TextInput
                  value={automaticPairingCode}
                  onChangeText={(value) => setAutomaticPairingCode(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor="#69796e"
                  style={styles.field}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  returnKeyType="done"
                  accessibilityLabel="Código temporal para descubrimiento automático"
                />
                <Pressable accessibilityRole="button" disabled={!bridgeReady || busy} onPress={() => void pairAutomatically()} style={[styles.primaryButton, (!bridgeReady || busy) && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{busy ? "DESCUBRIENDO…" : "EMPAREJAR Y CONECTAR AUTOMÁTICAMENTE"}</Text>
                </Pressable>
                <Text style={styles.webWarning}>Si mDNS no está disponible en la red, usa el modo manual para introducir host y puerto.</Text>
                <View style={styles.separator} />
                <Text style={styles.fieldLabel}>MODO MANUAL · HOST Y PUERTO</Text>

                <Text style={styles.fieldLabel}>PAIRING · HOST:PUERTO</Text>
                <TextInput
                  value={pairAddress}
                  onChangeText={setPairAddress}
                  placeholder="192.168.1.20:37123"
                  placeholderTextColor="#69796e"
                  style={styles.field}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="next"
                />
                <Text style={styles.fieldLabel}>CÓDIGO TEMPORAL · 6 DÍGITOS</Text>
                <TextInput
                  value={pairingCode}
                  onChangeText={(value) => setPairingCode(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor="#69796e"
                  style={styles.field}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  returnKeyType="done"
                  accessibilityLabel="Código temporal de pairing, seis dígitos"
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!bridgeReady || busy}
                  onPress={() => void pairDevice()}
                  style={[styles.primaryButton, (!bridgeReady || busy) && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>{busy ? "PROCESANDO…" : "EMPAREJAR"}</Text>
                </Pressable>

                <View style={styles.separator} />
                <Text style={styles.fieldLabel}>ADB · HOST:PUERTO</Text>
                <TextInput
                  value={connectAddress}
                  onChangeText={setConnectAddress}
                  placeholder="192.168.1.20:43217"
                  placeholderTextColor="#69796e"
                  style={styles.field}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="send"
                  onSubmitEditing={() => {
                    closeDialog();
                    void connectDevice();
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!bridgeReady || busy}
                  onPress={() => {
                    closeDialog();
                    void connectDevice();
                  }}
                  style={[styles.primaryButton, (!bridgeReady || busy) && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>CONECTAR Y ABRIR SHELL</Text>
                </Pressable>

                {!bridgeReady ? (
                  <Text style={styles.webWarning}>
                    {!NetadbBridge
                      ? "El puente nativo sólo se incluye en el APK Android."
                      : bridgeStatus === null
                        ? "Comprobando módulo ADB…"
                        : bridgeStatus.apiLevel < 30
                          ? "El pairing Wireless debugging requiere Android 11 o posterior."
                          : "El ejecutable ADB nativo no está disponible en esta build."}
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={commandsVisible} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCommandsVisible(false)}>
          <View style={styles.scrim}>
            <View style={styles.catalogPanel}>
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>Comandos frecuentes</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Cerrar comandos" onPress={() => setCommandsVisible(false)}>
                  <Text style={styles.dialogClose}>×</Text>
                </Pressable>
              </View>
              <Text style={styles.dialogCopy}>Toca un comando para cargarlo en el prompt. No se ejecutará hasta que pulses Enviar.</Text>
              <ScrollView style={styles.catalogList} keyboardShouldPersistTaps="handled">
                {QUICK_COMMANDS.map((item) => (
                  <Pressable
                    key={item.command}
                    accessibilityRole="button"
                    accessibilityLabel={`Seleccionar ${item.title}; no se ejecuta automáticamente`}
                    onPress={() => selectQuickCommand(item.command)}
                    style={styles.quickCommandCard}
                  >
                    <View style={styles.quickCommandHeader}>
                      <Text style={styles.quickCommandTitle}>{item.title}</Text>
                      <Text style={styles.quickCommandGroup}>{item.group}</Text>
                    </View>
                    <Text selectable style={styles.quickCommandCode}>{item.command}</Text>
                    <Text style={styles.quickCommandNote}>{item.note}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.catalogWarning}>Estos comandos son de consulta. Sus resultados pueden contener apps, redes o identificadores; revísalos antes de compartir.</Text>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    minHeight: 70,
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIcon: {
    width: 39,
    height: 39,
    backgroundColor: "#16271a",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#365a37",
    justifyContent: "center",
    alignItems: "center",
  },
  brandGlyph: { color: C.green, fontFamily: "monospace", fontWeight: "900", fontSize: 16 },
  kicker: { color: C.muted, fontFamily: "monospace", fontSize: 8, letterSpacing: 1 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginTop: 2 },
  connectButton: {
    borderWidth: 1,
    borderColor: "#426d45",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#17271a",
  },
  connectButtonText: { color: C.green, fontFamily: "monospace", fontSize: 9, fontWeight: "800" },
  statusBar: {
    minHeight: 38,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderColor: "#1a271e",
    backgroundColor: "#0e1510",
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontFamily: "monospace", fontSize: 8, letterSpacing: 0.55, fontWeight: "700" },
  serialLabel: { color: C.text, fontFamily: "monospace", fontSize: 9, marginLeft: "auto", maxWidth: "47%" },
  closeButton: { paddingVertical: 7, paddingLeft: 5 },
  closeButtonText: { color: C.red, fontFamily: "monospace", fontSize: 8, fontWeight: "800" },
  notice: { paddingHorizontal: 15, paddingVertical: 8, backgroundColor: "#19241b", borderBottomWidth: 1, borderColor: C.border },
  noticeError: { backgroundColor: "#2a1d1d", borderColor: "#5c3939" },
  noticeText: { color: C.amber, fontSize: 10, lineHeight: 15 },
  previewNotice: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#272116", borderBottomWidth: 1, borderColor: "#463a22" },
  previewNoticeText: { color: C.amber, fontSize: 10, lineHeight: 15 },
  deviceList: { padding: 11, gap: 6, borderBottomWidth: 1, borderColor: C.border },
  deviceListTitle: { color: C.muted, fontFamily: "monospace", fontSize: 8, letterSpacing: 0.8 },
  deviceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 9, borderColor: C.border, borderWidth: 1, borderRadius: 7 },
  deviceSerial: { color: C.text, fontFamily: "monospace", fontSize: 10 },
  deviceOpen: { color: C.green, fontFamily: "monospace", fontSize: 8, fontWeight: "800" },
  console: { flex: 1 },
  consoleContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 18, minHeight: "100%" },
  placeholder: { color: "#687a6d", fontFamily: "monospace", fontSize: 12 },
  outputLine: {
    color: "#c2d9c7",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 11,
    lineHeight: 17,
  },
  spinner: { alignSelf: "flex-start", marginTop: 10 },
  commandBar: {
    minHeight: 57,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: "#111a14",
  },
  catalogButton: { minHeight: 39, minWidth: 37, paddingHorizontal: 5, justifyContent: "center", alignItems: "center", borderRadius: 7, backgroundColor: "#1c2a20", borderWidth: 1, borderColor: C.border },
  catalogButtonText: { color: C.green, fontFamily: "monospace", fontSize: 8, fontWeight: "900" },
  clearButton: { height: 39, width: 36, justifyContent: "center", alignItems: "center", borderRadius: 7, backgroundColor: "#1c2a20" },
  clearButtonText: { color: C.muted, fontSize: 18 },
  commandInput: {
    flex: 1,
    minHeight: 41,
    color: C.text,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 7,
    paddingHorizontal: 10,
    fontFamily: "monospace",
    fontSize: 11,
  },
  sendButton: { minHeight: 39, paddingHorizontal: 11, borderRadius: 7, backgroundColor: C.green, justifyContent: "center" },
  sendButtonText: { color: "#0b160d", fontFamily: "monospace", fontSize: 8, fontWeight: "900" },
  disabled: { opacity: 0.42 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.76)", justifyContent: "center", padding: 16 },
  dialogScroll: { flexGrow: 1, justifyContent: "center" },
  dialog: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    padding: 17,
    borderRadius: 15,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: "#354b39",
    gap: 8,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dialogTitle: { color: C.text, fontWeight: "800", fontSize: 18 },
  dialogClose: { color: C.muted, fontSize: 26, paddingHorizontal: 5 },
  dialogCopy: { color: C.muted, fontSize: 11, lineHeight: 16, marginBottom: 3 },
  fieldLabel: { color: C.muted, fontFamily: "monospace", fontSize: 8, letterSpacing: 0.65, marginTop: 2, fontWeight: "700" },
  field: {
    minHeight: 42,
    color: C.text,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 7,
    paddingHorizontal: 10,
    fontFamily: "monospace",
    fontSize: 11,
  },
  primaryButton: { minHeight: 41, justifyContent: "center", alignItems: "center", borderRadius: 7, backgroundColor: C.green, paddingHorizontal: 10 },
  primaryButtonText: { color: "#0b160d", fontFamily: "monospace", fontWeight: "900", fontSize: 9, textAlign: "center" },
  separator: { height: 1, backgroundColor: C.border, marginVertical: 4 },
  webWarning: { color: C.amber, fontSize: 10, lineHeight: 15, padding: 9, backgroundColor: "#272116", borderRadius: 7, marginTop: 4 },
  catalogPanel: { width: "100%", maxWidth: 480, maxHeight: "88%", alignSelf: "center", padding: 16, borderRadius: 15, backgroundColor: C.panel, borderWidth: 1, borderColor: "#354b39" },
  catalogList: { flexShrink: 1, marginTop: 8 },
  quickCommandCard: { paddingVertical: 10, paddingHorizontal: 10, marginBottom: 7, borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: "#0d140f", gap: 4 },
  quickCommandHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  quickCommandTitle: { color: C.text, fontSize: 11, fontWeight: "700", flex: 1 },
  quickCommandGroup: { color: C.green, fontFamily: "monospace", fontSize: 7, fontWeight: "800", letterSpacing: 0.45 },
  quickCommandCode: { color: C.green, fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  quickCommandNote: { color: C.muted, fontSize: 9, lineHeight: 13 },
  catalogWarning: { color: C.amber, fontSize: 9, lineHeight: 14, padding: 8, marginTop: 7, backgroundColor: "#272116", borderRadius: 7 },
});
