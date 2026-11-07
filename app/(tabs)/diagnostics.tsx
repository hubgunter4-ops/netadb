import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, PermissionsAndroid, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { NetadbBridge } from "@/modules/netadb-bridge";
import type { BridgeStatus } from "@/modules/netadb-bridge";
import { classifyLogcatLine, parseExternalInboundConntrack, SNAPSHOT_COMMANDS, utcTimestamp, type ClassifiedEvent } from "@/lib/diagnostics/parser";
import { compareSnapshots } from "@/lib/diagnostics/snapshot-diff";

type Snapshot = { capturedAt: string; files: Record<string, string>; errors: string[] };
type LogEntry = { at: string; line: string; event: ClassifiedEvent | null };
const C = { bg: "#111814", panel: "#18221c", panel2: "#1d2a22", border: "#2c4130", text: "#e7f3e7", muted: "#90a394", green: "#7cff6b", amber: "#ffbe55", red: "#ff666d", cyan: "#67dce5", blue: "#75a9ff", magenta: "#e897ff" };
const toneColor: Record<ClassifiedEvent["tone"], string> = { green: C.green, yellow: C.amber, red: C.red, cyan: C.cyan, blue: C.blue, magenta: C.magenta, neutral: C.muted };

function Field({ label, value, onChangeText, placeholder, secure = false, keyboardType = "default" }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; secure?: boolean; keyboardType?: "default" | "numeric" }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#64746a" secureTextEntry={secure} keyboardType={keyboardType} autoCapitalize="none" autoCorrect={false} style={styles.input} selectionColor={C.green} /></View>;
}
function Action({ title, onPress, disabled, secondary = false, danger = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && !disabled && { opacity: 0.78 }]}><Text style={[styles.actionText, secondary && styles.actionTextSecondary, danger && { color: C.red }]}>{title}</Text></Pressable>;
}
function SectionTitle({ index, title, note }: { index: string; title: string; note?: string }) {
  return <View style={styles.sectionTitleRow}><Text style={styles.sectionIndex}>{index}</Text><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{title}</Text>{note ? <Text style={styles.sectionNote}>{note}</Text> : null}</View></View>;
}
function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

export default function HomeScreen() {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [serial, setSerial] = useState("");
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectPort, setConnectPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("ADB local aún no conectado");
  const [intervalText, setIntervalText] = useState("30");
  const [durationText, setDurationText] = useState("1800");
  const [includeTelephony, setIncludeTelephony] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const snapshotsRef = useRef<Snapshot[]>([]);
  const [comparisonBaseId, setComparisonBaseId] = useState("");
  const [comparisonCurrentId, setComparisonCurrentId] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logcatActive, setLogcatActive] = useState(false);
  const [logcatPath, setLogcatPath] = useState("");
  const [conntrackText, setConntrackText] = useState("");
  const [phoneIp, setPhoneIp] = useState("");
  const [conntrackResults, setConntrackResults] = useState<string[]>([]);
  const [reportPath, setReportPath] = useState("");
  const captureInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningCapture = useRef(false);
  const capturingRef = useRef(false);
  const logcatActiveRef = useRef(false);
  const logLineCount = useRef(0);

  useEffect(() => {
    if (!NetadbBridge) return;
    NetadbBridge.isAvailable().then(setBridgeStatus).catch((error: unknown) => setConnectionMessage(`Puente ADB no disponible: ${String(error)}`));
    const sub = NetadbBridge.addListener("onLogLine", (event: { line: string }) => {
      const line = event.line ?? "";
      logLineCount.current += 1;
      setLogs((previous) => [{ at: utcTimestamp(), line, event: classifyLogcatLine(line) }, ...previous].slice(0, 600));
    });
    return () => sub.remove();
  }, []);

  const startVisibleSession = async (status: string) => {
    if (!NetadbBridge || !serial) return false;
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      try {
        const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        const alreadyGranted = await PermissionsAndroid.check(permission);
        const result = alreadyGranted ? PermissionsAndroid.RESULTS.GRANTED : await PermissionsAndroid.request(permission, {
          title: "Notificación persistente de NetADB",
          message: "Android mostrará el estado de captura y cuántas líneas se registran mientras usas otras apps.",
          buttonPositive: "Permitir",
          buttonNegative: "Ahora no",
        });
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setConnectionMessage("Permite notificaciones para mantener el registro visible mientras NetADB queda en segundo plano.");
          return false;
        }
      } catch (error) {
        setConnectionMessage(`No se pudo solicitar permiso de notificaciones: ${String(error)}`);
        return false;
      }
    }
    try {
      await NetadbBridge.startDiagnosticsSession(serial, status);
      await NetadbBridge.updateDiagnosticsSession(serial, status, logLineCount.current);
      return true;
    } catch (error) {
      setConnectionMessage(`No se pudo iniciar el servicio visible de Android: ${String(error)}`);
      return false;
    }
  };

  const pair = async () => {
    if (!NetadbBridge) return;
    if (!pairPort.trim().includes(":") || !/^\d{6}$/.test(pairCode)) { setConnectionMessage("Introduce host:puerto para pairing y el código temporal de 6 dígitos mostrado por Android."); return; }
    const temporaryCode = pairCode;
    setPairCode("");
    setBusy(true); setConnectionMessage("Esperando autorización de emparejamiento…");
    try {
      const result = await NetadbBridge.pair(pairPort.trim(), temporaryCode);
      setConnectionMessage(result.success ? `Emparejamiento completado. ${result.output}` : `Emparejamiento pendiente o fallido. ${result.output}`);
    } catch (error) { setConnectionMessage(`Error de pairing: ${String(error)}`); } finally { setBusy(false); }
  };
  const connect = async () => {
    if (!NetadbBridge) return;
    if (!connectPort.trim().includes(":")) { setConnectionMessage("Introduce la IP o host y el puerto mostrados en Wireless debugging."); return; }
    setBusy(true); setConnectionMessage("Conectando al endpoint ADB inalámbrico…");
    try {
      const result = await NetadbBridge.connect(connectPort.trim());
      const devices = result.connected ? result.devices ?? [] : [];
      setAvailableDevices(devices);
      const selected = result.connected && devices.length === 1 ? result.targetSerial ?? devices[0] : "";
      setSerial(selected);
      setConnectionMessage(result.connected ? (selected ? `Endpoint objetivo autorizado: ${selected}\n${result.output}` : `El endpoint solicitado está autorizado. Hay ${devices.length} dispositivos disponibles; elige explícitamente el serial.\n${result.output}`) : `El endpoint solicitado no quedó autorizado; no se habilitó ningún dispositivo previo.\n${result.output}`);
    } catch (error) { setConnectionMessage(`No se pudo conectar: ${String(error)}`); } finally { setBusy(false); }
  };
  const takeSnapshot = async () => {
    if (!NetadbBridge || !serial || runningCapture.current) return;
    runningCapture.current = true;
    const capturedAt = utcTimestamp();
    const files: Record<string, string> = {};
    const errors: string[] = [];
    const commands: Array<readonly [string, string]> = [...SNAPSHOT_COMMANDS];
    if (includeTelephony) commands.push(["telephony_registry", "dumpsys telephony.registry"]);
    try {
      for (const [name, command] of commands) {
        try {
          const result = await NetadbBridge.runShell(serial, command);
          files[`${name}.txt`] = `# Captured UTC: ${capturedAt}\n# Command: ${command}\n# Exit code: ${result.exitCode ?? 0}\n\n${result.output}`;
          if ((result.exitCode ?? 0) !== 0) errors.push(`${name}: salida ${result.exitCode}`);
        } catch (error) {
          const message = String(error);
          files[`${name}.txt`] = `# Captured UTC: ${capturedAt}\n# Command: ${command}\n# Error: ${message}\n`;
          errors.push(`${name}: ${message}`);
        }
      }
      const snapshot = { capturedAt, files, errors };
      const previousSnapshots = snapshotsRef.current;
      const nextSnapshots = [snapshot, ...previousSnapshots].slice(0, 200);
      snapshotsRef.current = nextSnapshots;
      setSnapshots(nextSnapshots);
      setComparisonBaseId(previousSnapshots[0]?.capturedAt ?? "");
      setComparisonCurrentId(capturedAt);
      setLogs((previous) => [{ at: capturedAt, line: `Snapshot listo · ${Object.keys(files).length} fuentes · ${errors.length} avisos`, event: { label: "SNAPSHOT", detail: Object.keys(files).join(" · ") || "Sin resultados", tone: errors.length ? "yellow" : "green" } as const }, ...previous].slice(0, 600));
    } finally { runningCapture.current = false; }
  };
  const stopCapture = async () => {
    const wasCapturing = capturingRef.current;
    if (captureInterval.current) clearInterval(captureInterval.current);
    if (captureTimeout.current) clearTimeout(captureTimeout.current);
    captureInterval.current = null; captureTimeout.current = null; capturingRef.current = false; setCapturing(false);
    if (wasCapturing && NetadbBridge && serial) {
      try {
        if (logcatActiveRef.current) await NetadbBridge.updateDiagnosticsSession(serial, "Logcat activo en segundo plano", logLineCount.current);
        else await NetadbBridge.stopDiagnosticsSession();
      } catch (error) { setConnectionMessage(`No se pudo actualizar la notificación: ${String(error)}`); }
    }
  };
  const startCapture = async () => {
    if (!NetadbBridge || !serial || capturingRef.current) return;
    const intervalSeconds = Number(intervalText); const durationSeconds = Number(durationText);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5 || !Number.isFinite(durationSeconds) || durationSeconds < 0) { setConnectionMessage("Usa un intervalo de al menos 5 segundos y una duración igual o mayor que 0."); return; }
    const status = logcatActiveRef.current ? "Snapshots y logcat en segundo plano" : "Snapshots en segundo plano";
    if (!(await startVisibleSession(status))) return;
    capturingRef.current = true;
    setCapturing(true);
    await takeSnapshot();
    captureInterval.current = setInterval(() => void takeSnapshot(), intervalSeconds * 1000);
    if (durationSeconds > 0) captureTimeout.current = setTimeout(() => void stopCapture(), durationSeconds * 1000);
  };
  const toggleLogcat = async () => {
    if (!NetadbBridge || !serial) return;
    if (logcatActiveRef.current) {
      NetadbBridge.stopLogcat();
      logcatActiveRef.current = false; setLogcatActive(false);
      try {
        if (capturingRef.current) await NetadbBridge.updateDiagnosticsSession(serial, "Snapshots en segundo plano", logLineCount.current);
        else await NetadbBridge.stopDiagnosticsSession();
      } catch (error) { setConnectionMessage(`No se pudo cerrar la notificación: ${String(error)}`); }
      return;
    }
    const status = capturingRef.current ? "Snapshots y logcat en segundo plano" : "Logcat en segundo plano";
    if (!(await startVisibleSession(status))) return;
    try {
      setLogcatPath(NetadbBridge.startLogcat(serial, ["main", "system", "events", "radio", "crash"]));
      logcatActiveRef.current = true; setLogcatActive(true);
    } catch (error) {
      setConnectionMessage(`No se pudo iniciar logcat: ${String(error)}`);
      if (!capturingRef.current) await NetadbBridge.stopDiagnosticsSession();
    }
  };
  const analyzeConntrack = () => {
    const results = conntrackText.split(/\r?\n/).map((line) => parseExternalInboundConntrack(line, phoneIp)).filter((item): item is string => Boolean(item));
    setConntrackResults(results.length ? results : ["No se encontraron candidatos entrantes NEW que coincidan con la IP indicada. Esto no prueba ausencia de tráfico entrante: depende del registro y de la traducción de red."]);
  };
  const createBugreport = () => {
    if (!NetadbBridge || !serial) return;
    const bridge = NetadbBridge;
    if (!bridge) return;
    const run = async () => {
      if (!(await startVisibleSession("Bugreport en segundo plano"))) return;
      setBusy(true);
      try {
        const result = await bridge.bugreport(serial);
        setReportPath(result.filePath ?? "");
        setSnapshots((previous) => [{ capturedAt: utcTimestamp(), files: { "bugreport.txt": result.output }, errors: (result.exitCode ?? 0) === 0 ? [] : [`bugreport terminó con código ${result.exitCode}`] }, ...previous].slice(0, 200));
        setConnectionMessage(result.filePath ? "Bugreport ZIP generado. Revisa y comparte el archivo desde el botón disponible." : `Bugreport terminó, pero ADB no devolvió el archivo ZIP: ${result.output}`);
      } catch (error) { setConnectionMessage(`Bugreport fallido: ${String(error)}`); } finally {
        setBusy(false);
        try {
          if (capturingRef.current || logcatActiveRef.current) {
            const status = capturingRef.current && logcatActiveRef.current ? "Snapshots y logcat en segundo plano" : capturingRef.current ? "Snapshots en segundo plano" : "Logcat en segundo plano";
            await bridge.updateDiagnosticsSession(serial, status, logLineCount.current);
          } else await bridge.stopDiagnosticsSession();
        } catch (error) { setConnectionMessage(`No se pudo cerrar el estado de bugreport: ${String(error)}`); }
      }
    };
    Alert.alert("Crear bugreport", "El informe puede tardar varios minutos y contener identificadores, redes y otros datos sensibles. ¿Continuar?", [{ text: "Cancelar", style: "cancel" }, { text: "Crear", onPress: () => void run() }]);
  };
  const exportSession = async () => {
    const payload = { product: "NetADB", exportedAt: utcTimestamp(), device: serial || null, note: "Los eventos locales observados no identifican necesariamente el origen externo ni prueban recepción por una app.", snapshots, logcat: logs, conntrackCandidates: conntrackResults };
    try {
      const contents = JSON.stringify(payload, null, 2);
      if (NetadbBridge) {
        const path = await NetadbBridge.writeExport(`netadb-session-${Date.now()}.json`, contents);
        await NetadbBridge.shareFile(path, "application/json");
      } else {
        await Share.share({ title: "Exportar sesión NetADB", message: contents });
      }
    }
    catch (error) { setConnectionMessage(`No se pudo compartir la sesión: ${String(error)}`); }
  };
  const shareLogcat = async () => {
    if (!NetadbBridge || !logcatPath) return;
    try { await NetadbBridge.shareFile(logcatPath, "text/plain"); }
    catch (error) { setConnectionMessage(`No se pudo compartir logcat: ${String(error)}`); }
  };
  const clearLocalData = async () => {
    setBusy(true);
    try {
      if (capturingRef.current) await stopCapture();
      if (logcatActiveRef.current && NetadbBridge) {
        NetadbBridge.stopLogcat();
        logcatActiveRef.current = false; setLogcatActive(false);
      }
      let filesDeleted = 0;
      let bytesDeleted = 0;
      if (NetadbBridge) {
        await NetadbBridge.stopDiagnosticsSession();
        const result = await NetadbBridge.deleteDiagnosticFiles();
        filesDeleted = result.filesDeleted;
        bytesDeleted = result.bytesDeleted;
      }
      snapshotsRef.current = [];
      setSnapshots([]); setComparisonBaseId(""); setComparisonCurrentId(""); setLogs([]); logLineCount.current = 0;
      setConntrackText(""); setPhoneIp(""); setConntrackResults([]);
      setLogcatPath(""); setReportPath(""); setConnectionMessage(`Se borraron ${filesDeleted} archivos locales (${(bytesDeleted / 1024 / 1024).toFixed(2)} MiB) y el registro de esta sesión.`);
    } catch (error) { setConnectionMessage(`No se pudieron borrar todos los datos locales: ${String(error)}`); }
    finally { setBusy(false); }
  };
  const confirmClearLocalData = () => {
    const message = "Se detendrán snapshots y logcat, se borrarán JSON, TXT y ZIP privados de NetADB y se limpiará el registro visible. Esta acción no se puede deshacer.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void clearLocalData();
      return;
    }
    Alert.alert("Borrar datos locales", message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => void clearLocalData() },
    ]);
  };
  const androidReady = Platform.OS === "android" && Boolean(NetadbBridge) && bridgeStatus?.available === true && bridgeStatus.apiLevel >= 30;
  const comparisonBase = snapshots.find((item) => item.capturedAt === comparisonBaseId);
  const comparisonCurrent = snapshots.find((item) => item.capturedAt === comparisonCurrentId);
  const comparison = useMemo(() => comparisonBase && comparisonCurrent ? compareSnapshots(comparisonBase, comparisonCurrent) : null, [comparisonBase, comparisonCurrent]);

  return (
    <ScreenContainer containerClassName="bg-[#111814]" safeAreaClassName="bg-[#111814]" style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.brandMark}><Text style={styles.brandGlyph}>N</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.eyebrow}>LOCAL · ANDROID · ADB</Text><Text style={styles.brandTitle}>NetADB</Text></View>
            <View style={[styles.livePill, (capturing || logcatActive) && styles.livePillActive]}><View style={[styles.dot, (capturing || logcatActive) && { backgroundColor: C.green }]} /><Text style={styles.liveText}>{capturing || logcatActive ? "ACTIVO · FGS" : "EN ESPERA"}</Text></View>
          </View>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>DIAGNÓSTICO DE CONECTIVIDAD</Text>
            <Text style={styles.heroTitle}>Señales locales.{"\n"}<Text style={{ color: C.green }}>Evidencia exportable.</Text></Text>
            <Text style={styles.heroBody}>Empareja el dispositivo Android objetivo por Wireless debugging. Los registros permanecen en este teléfono hasta que eliges compartirlos.</Text>
          </View>
          <View style={styles.statusCard}>
            <View style={styles.cardTopline}><Text style={styles.cardLabel}>ESTADO DEL PUENTE ADB</Text><View style={[styles.statusDot, { backgroundColor: androidReady ? C.green : C.amber }]} /></View>
            <Text style={styles.statusHeadline}>{androidReady ? (serial ? "Dispositivo seleccionado" : availableDevices.length > 1 ? "Conexión lista · falta elegir serial" : "Motor instalado · sin sesión") : Platform.OS === "web" ? "Vista previa web" : bridgeStatus && bridgeStatus.apiLevel < 30 ? "Wireless debugging requiere Android 11+" : bridgeStatus?.available === false ? "Motor ADB no disponible" : "Comprobando motor ADB…"}</Text>
            <Text style={styles.statusBody}>{androidReady ? (serial ? `Dispositivo ${serial}` : availableDevices.length > 1 ? `Hay ${availableDevices.length} dispositivos autorizados. Selecciona un serial antes de iniciar capturas o logcat.` : `Android ${bridgeStatus.androidVersion} · API ${bridgeStatus.apiLevel}`) : Platform.OS === "web" ? "La ejecución ADB requiere el APK Android; aquí puedes revisar la interfaz." : bridgeStatus && bridgeStatus.apiLevel < 30 ? "El emparejamiento inalámbrico del sistema requiere Android 11 o posterior." : "Instala la versión Android compilada con el módulo nativo NetADB."}</Text>
          </View>
          <View style={styles.section}>
            <SectionTitle index="01" title="Emparejar y conectar" note="Ajustes → Opciones de desarrollador → Depuración inalámbrica" />
            <View style={styles.panel}>
              <Text style={styles.panelHeading}>Emparejamiento temporal</Text>
              <Text style={styles.panelCopy}>Mantén abierta la pantalla de pairing de Android mientras introduces sus datos.</Text>
              <View style={styles.twoColumns}><View style={{ flex: 1 }}><Field label="IP:PUERTO DE PAIRING" value={pairPort} onChangeText={setPairPort} placeholder="localhost:37401" /></View><View style={{ flex: 0.8 }}><Field label="CÓDIGO TEMPORAL" value={pairCode} onChangeText={(value) => setPairCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" secure keyboardType="numeric" /></View></View>
              <Action title={busy ? "PROCESANDO…" : "EMPAREJAR TELÉFONO"} onPress={() => void pair()} disabled={!androidReady || busy || capturing || logcatActive} />
              <Field label="IP:PUERTO WIRELESS DEBUGGING" value={connectPort} onChangeText={setConnectPort} placeholder="192.168.1.20:5555 o localhost:5555" />
              <Action title="CONECTAR DISPOSITIVO" onPress={() => void connect()} disabled={!androidReady || busy || capturing || logcatActive} secondary />
              <View style={styles.notice}><Text style={styles.noticeMark}>i</Text><Text style={styles.noticeText}>El código se usa solo durante pairing y no se guarda. Android puede pedir aceptar la autorización en pantalla.</Text></View>
              {busy ? <ActivityIndicator color={C.green} style={{ marginTop: 6 }} /> : null}
              {connectionMessage ? <Text selectable style={styles.consoleText}>{connectionMessage}</Text> : null}
              {availableDevices.length > 1 ? <View style={styles.devicePicker}>{availableDevices.map((device) => <Pressable key={device} disabled={capturing || logcatActive} onPress={() => setSerial(device)} style={[styles.deviceOption, serial === device && styles.deviceOptionSelected, (capturing || logcatActive) && { opacity: 0.45 }]}><Text style={[styles.deviceOptionText, serial === device && { color: C.green }]}>{device}</Text></Pressable>)}</View> : null}
            </View>
          </View>
          <View style={styles.section}>
            <SectionTitle index="02" title="Captura del sistema" note="Snapshots UTC de conectividad y redes" />
            <View style={styles.panel}>
              <View style={styles.twoColumns}><View style={{ flex: 1 }}><Field label="INTERVALO · SEGUNDOS" value={intervalText} onChangeText={setIntervalText} placeholder="30" keyboardType="numeric" /></View><View style={{ flex: 1 }}><Field label="DURACIÓN · 0 = MANUAL" value={durationText} onChangeText={setDurationText} placeholder="1800" keyboardType="numeric" /></View></View>
              <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.switchTitle}>Incluir telephony.registry</Text><Text style={styles.switchCopy}>Puede revelar datos de SIM y celdas.</Text></View><Switch value={includeTelephony} onValueChange={setIncludeTelephony} trackColor={{ false: "#405046", true: "#3e8f48" }} thumbColor={includeTelephony ? C.green : "#a8b7ac"} /></View>
              <View style={styles.noticeWarning}><Text style={styles.noticeMarkWarning}>!</Text><Text style={styles.noticeText}>Para seguir en segundo plano y con pantalla apagada, NetADB mantiene la CPU despierta mientras la captura o logcat esté activo. Consume batería; detén el registro al terminar.</Text></View>
              <View style={styles.buttonRow}><View style={{ flex: 1 }}><Action title={capturing ? "CAPTURANDO" : "INICIAR SNAPSHOTS"} onPress={() => void startCapture()} disabled={!serial || capturing || busy} /></View><View style={{ flex: 0.75 }}><Action title="DETENER" onPress={stopCapture} disabled={!capturing} secondary danger /></View></View>
              <View style={styles.metricsRow}><Metric value={String(snapshots.length)} label="CAPTURAS" /><Metric value={Object.keys(snapshots[0]?.files ?? {}).length ? String(Object.keys(snapshots[0].files).length) : "—"} label="FUENTES" /><Metric value={String(logs.length)} label="EVENTOS" /></View>
              <View style={styles.compareBlock}>
                <Text style={styles.panelHeading}>Comparar capturas</Text>
                <Text style={styles.panelCopy}>Elige una captura base (A) y otra más reciente (B). Las diferencias se calculan localmente por archivo.</Text>
                <Text style={styles.smallCaps}>A · CAPTURA BASE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compareChips}>
                  {snapshots.map((item) => <Pressable key={`base-${item.capturedAt}`} onPress={() => setComparisonBaseId(item.capturedAt)} style={[styles.compareChip, comparisonBaseId === item.capturedAt && styles.compareChipSelected]}><Text style={[styles.compareChipText, comparisonBaseId === item.capturedAt && { color: C.green }]}>{item.capturedAt.slice(11, 19)}Z · {item.capturedAt.slice(0, 10)}</Text></Pressable>)}
                </ScrollView>
                <Text style={styles.smallCaps}>B · CAPTURA ACTUAL</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compareChips}>
                  {snapshots.map((item) => <Pressable key={`current-${item.capturedAt}`} onPress={() => setComparisonCurrentId(item.capturedAt)} style={[styles.compareChip, comparisonCurrentId === item.capturedAt && styles.compareChipSelected]}><Text style={[styles.compareChipText, comparisonCurrentId === item.capturedAt && { color: C.green }]}>{item.capturedAt.slice(11, 19)}Z · {item.capturedAt.slice(0, 10)}</Text></Pressable>)}
                </ScrollView>
                {!comparison ? <Text style={styles.emptyText}>Necesitas dos snapshots en memoria para comparar.</Text> : <>
                  <View style={styles.metricsRow}><Metric value={`+${comparison.addedCount}`} label="AÑADIDAS" /><Metric value={`−${comparison.removedCount}`} label="ELIMINADAS" /><Metric value={String(comparison.changedSources)} label="FUENTES CON CAMBIO" /></View>
                  {comparison.changedSources === 0 ? <Text style={styles.emptyText}>No se encontraron diferencias textuales en las fuentes seleccionadas.</Text> : comparison.sources.filter((source) => source.addedCount > 0 || source.removedCount > 0 || source.missingFromBase || source.missingFromCurrent).slice(0, 12).map((source) => <View key={source.source} style={styles.diffSource}>
                    <Text style={styles.diffSourceTitle}>{source.source} · +{source.addedCount} / −{source.removedCount}</Text>
                    {source.missingFromBase ? <Text style={styles.rawLine}>Fuente solo presente en B.</Text> : null}
                    {source.missingFromCurrent ? <Text style={styles.rawLine}>Fuente solo presente en A.</Text> : null}
                    <Text style={styles.diffCategories}>{Object.entries(source.categories).map(([name, count]) => `${name} ${count}`).join(" · ") || "Sin categoría reconocida"}</Text>
                    {source.added.slice(0, 5).map((item, index) => <Text selectable key={`a-${index}`} style={[styles.rawLine, { color: C.green }]}>+ {item.count > 1 ? `(${item.count}) ` : ""}{item.line}</Text>)}
                    {source.removed.slice(0, 5).map((item, index) => <Text selectable key={`r-${index}`} style={[styles.rawLine, { color: C.amber }]}>− {item.count > 1 ? `(${item.count}) ` : ""}{item.line}</Text>)}
                    {source.truncated ? <Text style={styles.legalText}>Fuente extensa: se compararon las primeras 30 000 líneas de cada lado.</Text> : null}
                  </View>) }
                  {comparison.baseErrors.length || comparison.currentErrors.length ? <Text style={styles.noticeText}>Avisos capturas A/B: A [{comparison.baseErrors.join("; ") || "ninguno"}] · B [{comparison.currentErrors.join("; ") || "ninguno"}]</Text> : null}
                  <Text style={styles.legalText}>Comparación textual y heurística; los grupos no prueban causa raíz. No se modifican snapshots ni se envían fuera del teléfono.</Text>
                </>}
              </View>
            </View>
          </View>
          <View style={styles.section}>
            <SectionTitle index="03" title="Logcat en vivo" note="main · system · events · radio · crash" />
            <View style={styles.panel}>
              <View style={styles.buttonRow}><View style={{ flex: 1 }}><Action title={logcatActive ? "DETENER LOGCAT" : "INICIAR LOGCAT"} onPress={toggleLogcat} disabled={!serial} secondary={logcatActive} /></View><Text style={[styles.smallCaps, { alignSelf: "center" }]}>{logcatActive ? "STREAM ACTIVO" : "STREAM INACTIVO"}</Text></View>
              {logcatPath ? <Action title="COMPARTIR LOGCAT COMPLETO .TXT" onPress={() => void shareLogcat()} secondary /> : null}
              {logs.length === 0 ? <Text style={styles.emptyText}>Los eventos clasificados aparecerán al iniciar capturas o logcat.</Text> : logs.slice(0, 30).map((entry, index) => <View key={`${entry.at}-${index}`} style={styles.logRow}><View style={[styles.logAccent, { backgroundColor: entry.event ? toneColor[entry.event.tone] : C.border }]} /><View style={{ flex: 1 }}><View style={styles.logMeta}><Text style={styles.logTime}>{entry.at.slice(11, 19)}Z</Text><Text style={[styles.logType, { color: entry.event ? toneColor[entry.event.tone] : C.muted }]}>{entry.event?.label ?? "SISTEMA"}</Text></View><Text selectable style={styles.logDetail}>{entry.event?.detail ?? entry.line}</Text>{entry.event && <Text selectable style={styles.rawLine}>{entry.line}</Text>}</View></View>)}
            </View>
          </View>
          <View style={styles.section}>
            <SectionTitle index="04" title="Conntrack del router" note="Análisis local de texto aportado por ti" />
            <View style={styles.panel}>
              <Text style={styles.panelCopy}>Pega un registro de conntrack actualizado. No se leen archivos del router automáticamente.</Text>
              <Field label="IP LOCAL ACTUAL DEL TELÉFONO" value={phoneIp} onChangeText={setPhoneIp} placeholder="192.168.1.44" />
              <TextInput value={conntrackText} onChangeText={setConntrackText} placeholder="Pega aquí líneas de conntrack…" placeholderTextColor="#64746a" multiline textAlignVertical="top" style={[styles.input, styles.multiline]} />
              <Action title="ANALIZAR REGISTRO" onPress={analyzeConntrack} disabled={!conntrackText.trim() || !phoneIp.trim()} secondary />
              <View style={styles.noticeWarning}><Text style={styles.noticeMarkWarning}>!</Text><Text style={styles.noticeText}>Conntrack solo identifica candidatos. No demuestra que una aplicación haya recibido datos ni que el firewall los haya aceptado.</Text></View>
              {conntrackResults.map((result, index) => <Text selectable key={index} style={styles.candidate}>{result}</Text>)}
            </View>
          </View>
          <View style={styles.section}>
            <SectionTitle index="05" title="Paquete de evidencia" note="Exportación bajo demanda · datos locales" />
            <View style={styles.panel}>
              <Text style={styles.panelCopy}>Incluye snapshots, eventos visibles, candidatos conntrack y marcas UTC. Revisa el contenido antes de compartirlo.</Text>
              <View style={styles.buttonRow}><View style={{ flex: 1 }}><Action title="COMPARTIR SESIÓN" onPress={() => void exportSession()} secondary /></View><View style={{ flex: 0.82 }}><Action title="BUGREPORT" onPress={createBugreport} disabled={!serial || busy} secondary /></View></View>
              {reportPath ? <Action title="COMPARTIR BUGREPORT ZIP" onPress={() => void NetadbBridge?.shareFile(reportPath, "application/zip")} secondary /> : null}
              <Text style={styles.noticeText}>Con otra app abierta, una notificación persistente confirma el estado y el número de líneas guardadas. El contenido detallado se ve al volver a NetADB; Android o el fabricante aún pueden imponer restricciones de batería.</Text>
              <Action title="BORRAR DATOS LOCALES" onPress={confirmClearLocalData} disabled={busy} secondary danger />
              <Text style={styles.legalText}>LADB y su ejecutable ADB se distribuyen con avisos de licencia. Este APK es para instalación directa, fuera de Google Play. Ninguna captura prueba por sí sola origen externo o recepción por una app.</Text>
              <Link href={"/licenses" as never} asChild><Pressable style={styles.legalLink}><Text style={styles.legalLinkText}>Ver licencias completas incluidas en el APK →</Text></Pressable></Link>
            </View>
          </View>
          <Text style={styles.footer}>NETADB · DIAGNÓSTICO LOCAL · {utcTimestamp().slice(0, 10)}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, page: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 120, gap: 21, maxWidth: 720, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 3 }, brandMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#203222", borderWidth: 1, borderColor: "#527f4e", alignItems: "center", justifyContent: "center" }, brandGlyph: { color: C.green, fontSize: 25, fontWeight: "800", fontFamily: "monospace" }, eyebrow: { color: C.muted, fontFamily: "monospace", fontSize: 9, letterSpacing: 1.4 }, brandTitle: { color: C.text, fontSize: 20, fontWeight: "800" }, livePill: { flexDirection: "row", alignItems: "center", borderColor: C.border, borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 7, gap: 6 }, livePillActive: { borderColor: "#4d9444" }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.amber }, liveText: { color: C.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 0.7 },
  hero: { paddingTop: 10, paddingBottom: 4, gap: 9 }, heroKicker: { color: C.green, fontFamily: "monospace", letterSpacing: 1.3, fontSize: 10, fontWeight: "700" }, heroTitle: { color: C.text, fontSize: 30, fontWeight: "800", lineHeight: 36, letterSpacing: -0.8 }, heroBody: { color: C.muted, fontSize: 13, lineHeight: 20, maxWidth: 540 }, statusCard: { borderColor: C.border, borderWidth: 1, backgroundColor: C.panel, borderRadius: 16, padding: 16 }, cardTopline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, cardLabel: { color: C.muted, fontFamily: "monospace", fontSize: 9, letterSpacing: 1.1 }, statusDot: { height: 8, width: 8, borderRadius: 5 }, statusHeadline: { color: C.text, fontSize: 19, fontWeight: "700", marginTop: 12 }, statusBody: { color: C.muted, fontSize: 12, marginTop: 5, lineHeight: 18 },
  section: { gap: 10 }, sectionTitleRow: { flexDirection: "row", gap: 11, alignItems: "flex-start" }, sectionIndex: { color: C.green, fontFamily: "monospace", fontSize: 11, marginTop: 2, fontWeight: "700" }, sectionTitle: { color: C.text, fontSize: 17, fontWeight: "700" }, sectionNote: { color: C.muted, fontSize: 11, marginTop: 3 }, panel: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 15, gap: 12 }, panelHeading: { color: C.text, fontSize: 14, fontWeight: "700" }, panelCopy: { color: C.muted, fontSize: 12, lineHeight: 18 },
  fieldWrap: { gap: 6 }, fieldLabel: { color: C.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 0.65, fontWeight: "600" }, input: { minHeight: 44, borderWidth: 1, borderColor: C.border, backgroundColor: "#101713", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: C.text, fontFamily: "monospace", fontSize: 12 }, multiline: { minHeight: 102, maxHeight: 190 }, twoColumns: { flexDirection: "row", gap: 10 }, buttonRow: { flexDirection: "row", gap: 9, alignItems: "center" }, action: { minHeight: 45, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.green }, actionSecondary: { backgroundColor: "#203126", borderWidth: 1, borderColor: "#426947" }, actionDanger: { borderColor: "#704448", backgroundColor: "#2c2021" }, actionDisabled: { opacity: 0.42 }, actionText: { color: "#102013", fontSize: 10, fontWeight: "800", fontFamily: "monospace", letterSpacing: 0.5, textAlign: "center" }, actionTextSecondary: { color: C.green },
  notice: { flexDirection: "row", backgroundColor: "#16231b", borderRadius: 10, padding: 10, gap: 8, alignItems: "flex-start" }, noticeMark: { color: C.cyan, fontFamily: "monospace", fontWeight: "900" }, noticeText: { color: "#b1c1b5", fontSize: 10, lineHeight: 15, flex: 1 }, noticeWarning: { flexDirection: "row", backgroundColor: "#2c2518", borderRadius: 10, padding: 10, gap: 8, alignItems: "flex-start" }, noticeMarkWarning: { color: C.amber, fontFamily: "monospace", fontWeight: "900" }, consoleText: { color: C.cyan, fontSize: 10, lineHeight: 15, fontFamily: "monospace", paddingTop: 4 }, switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 10 }, switchTitle: { color: C.text, fontSize: 12, fontWeight: "600" }, switchCopy: { color: C.muted, fontSize: 10, marginTop: 3 }, metricsRow: { flexDirection: "row", borderTopColor: C.border, borderTopWidth: 1, paddingTop: 12, gap: 6 }, metric: { flex: 1, alignItems: "center", gap: 3 }, metricValue: { color: C.green, fontFamily: "monospace", fontSize: 16, fontWeight: "700" }, metricLabel: { color: C.muted, fontFamily: "monospace", fontSize: 8, letterSpacing: 0.8 }, smallCaps: { color: C.muted, fontFamily: "monospace", fontSize: 8, letterSpacing: 0.7 }, emptyText: { color: C.muted, fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  logRow: { flexDirection: "row", gap: 9, paddingVertical: 10, borderTopColor: C.border, borderTopWidth: StyleSheet.hairlineWidth }, logAccent: { width: 2, borderRadius: 2 }, logMeta: { flexDirection: "row", gap: 9, alignItems: "center" }, logTime: { color: C.muted, fontSize: 9, fontFamily: "monospace" }, logType: { fontSize: 9, fontWeight: "800", fontFamily: "monospace", letterSpacing: 0.4 }, logDetail: { color: C.text, fontSize: 11, lineHeight: 16, marginTop: 4 }, rawLine: { color: "#7e9283", fontSize: 9, lineHeight: 14, fontFamily: "monospace", marginTop: 5 }, candidate: { color: C.amber, fontFamily: "monospace", fontSize: 10, lineHeight: 16, paddingVertical: 5 }, legalText: { color: "#748278", fontSize: 9, lineHeight: 14 }, legalLink: { paddingVertical: 5 }, legalLinkText: { color: C.green, fontSize: 10, fontWeight: "700" }, devicePicker: { gap: 6 }, deviceOption: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10 }, deviceOptionSelected: { borderColor: C.green, backgroundColor: "#203126" }, deviceOptionText: { color: C.text, fontFamily: "monospace", fontSize: 11 }, footer: { color: "#536157", fontSize: 8, fontFamily: "monospace", letterSpacing: 1.3, textAlign: "center", paddingVertical: 5 },
  compareBlock: { gap: 9, borderTopColor: C.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 }, compareChips: { flexDirection: "row", gap: 7, paddingVertical: 2 }, compareChip: { borderWidth: 1, borderColor: C.border, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#101713" }, compareChipSelected: { borderColor: "#4d9444", backgroundColor: "#203126" }, compareChipText: { color: C.muted, fontSize: 8, fontFamily: "monospace" }, diffSource: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 8, gap: 3 }, diffSourceTitle: { color: C.text, fontFamily: "monospace", fontSize: 10, fontWeight: "700" }, diffCategories: { color: C.cyan, fontSize: 9, fontFamily: "monospace", lineHeight: 14 },
});
