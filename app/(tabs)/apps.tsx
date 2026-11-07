import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { NetadbBridge } from "@/modules/netadb-bridge";
import type { ShizukuAction, ShizukuInspection, ShizukuPackage, ShizukuStatus, VpnAppTarget, VpnCaptureStatus } from "@/modules/netadb-bridge";

const C = { bg: "#111814", panel: "#18221c", panel2: "#1d2a22", border: "#2c4130", text: "#e7f3e7", muted: "#90a394", green: "#7cff6b", amber: "#ffbe55", red: "#ff666d", cyan: "#67dce5" };
const SHIZUKU_SETUP = "https://shizuku.rikka.app/guide/setup/";
type Message = { tone: "good" | "warn" | "bad"; text: string };

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${amount.toFixed(1)} ${units[unit]}`;
}

function Button({ label, onPress, disabled, secondary = false, danger = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, danger && styles.danger, disabled && styles.disabled, pressed && !disabled && { opacity: 0.78 }]}><Text style={[styles.buttonText, secondary && styles.secondaryText, danger && { color: C.red }]}>{label}</Text></Pressable>;
}
function CardTitle({ title, note }: { title: string; note?: string }) {
  return <View style={{ gap: 3 }}><Text style={styles.cardTitle}>{title}</Text>{note ? <Text style={styles.note}>{note}</Text> : null}</View>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || "No disponible"}</Text></View>;
}

export default function AppsScreen() {
  const [status, setStatus] = useState<ShizukuStatus | null>(null);
  const [packages, setPackages] = useState<ShizukuPackage[]>([]);
  const [includeUserApps, setIncludeUserApps] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [busyPackage, setBusyPackage] = useState("");
  const [selected, setSelected] = useState("");
  const [inspection, setInspection] = useState<ShizukuInspection | null>(null);
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const [vpnStatus, setVpnStatus] = useState<VpnCaptureStatus | null>(null);
  const [vpnTargets, setVpnTargets] = useState<VpnAppTarget[]>([]);
  const [vpnTargetPackage, setVpnTargetPackage] = useState("");
  const [vpnQuery, setVpnQuery] = useState("");
  const [vpnLoading, setVpnLoading] = useState(false);
  const [vpnBusy, setVpnBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!NetadbBridge) {
      setStatus({ serviceRunning: false, permissionGranted: false, uid: -1, apiVersion: 0 });
      return;
    }
    setStatusBusy(true);
    try { setStatus(await NetadbBridge.getShizukuStatus()); }
    catch (error) { setMessage({ tone: "bad", text: `No se pudo consultar Shizuku: ${String(error)}` }); }
    finally { setStatusBusy(false); }
  }, []);

  const refreshVpnStatus = useCallback(async () => {
    if (!NetadbBridge) { setVpnStatus(null); return; }
    try {
      const next = await NetadbBridge.getVpnCaptureStatus();
      setVpnStatus(next);
      if (next.packageName) setVpnTargetPackage(next.packageName);
    } catch (error) {
      setMessage({ tone: "bad", text: `No se pudo consultar la captura VPN: ${String(error)}` });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshVpnStatus();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { void refreshStatus(); void refreshVpnStatus(); }
    });
    return () => subscription.remove();
  }, [refreshStatus, refreshVpnStatus]);

  useEffect(() => {
    if (!vpnStatus?.running) return;
    const timer = setInterval(() => void refreshVpnStatus(), 1000);
    return () => clearInterval(timer);
  }, [vpnStatus?.running, refreshVpnStatus]);

  const canUseShizuku = status?.serviceRunning === true && status.uid === 2000 && status.permissionGranted === true;
  const loadPackages = useCallback(async () => {
    if (!NetadbBridge) { setMessage({ tone: "warn", text: "El puente nativo solo está disponible en el APK Android." }); return; }
    if (!canUseShizuku) { setMessage({ tone: "warn", text: "Inicia Shizuku en modo ADB y concede su permiso a NetADB antes de cargar paquetes." }); return; }
    setLoading(true);
    try {
      const result = await NetadbBridge.listShizukuPackages(includeUserApps);
      setPackages(result);
      setMessage({ tone: "good", text: `${result.length} paquetes recibidos de Android. Solo se consultó información; no se modificó ningún paquete.` });
    } catch (error) { setMessage({ tone: "bad", text: `No se pudo enumerar paquetes: ${String(error)}` }); }
    finally { setLoading(false); }
  }, [canUseShizuku, includeUserApps]);

  const requestPermission = async () => {
    if (!NetadbBridge) return;
    try {
      await NetadbBridge.requestShizukuPermission();
      setMessage({ tone: "warn", text: "Aprueba el permiso de NetADB en el diálogo de Shizuku y vuelve a comprobar el estado." });
    } catch (error) { setMessage({ tone: "bad", text: String(error) }); }
  };

  const inspect = async (packageName: string) => {
    if (!NetadbBridge || !canUseShizuku) return;
    setSelected(packageName); setInspection(null); setInspectionBusy(true);
    try {
      setInspection(await NetadbBridge.inspectShizukuPackage(packageName));
      setMessage({ tone: "good", text: `Inspección de solo lectura recibida para ${packageName}.` });
    } catch (error) { setMessage({ tone: "bad", text: `No se pudo inspeccionar ${packageName}: ${String(error)}` }); }
    finally { setInspectionBusy(false); }
  };

  const doAction = async (app: ShizukuPackage, action: ShizukuAction) => {
    const bridge = NetadbBridge;
    if (!bridge || !canUseShizuku || busyPackage) return;
    const verb = action === "force-stop" ? "detener forzosamente" : action === "disable-user" ? "deshabilitar para el usuario Android actual" : "volver a habilitar";
    const explanation = action === "disable-user"
      ? "Esto puede desactivar funciones del fabricante o del sistema. No borra datos, pero el comportamiento varía por dispositivo."
      : action === "force-stop"
        ? "La app dejará de ejecutarse hasta que Android o la persona la inicie de nuevo."
        : "Esto vuelve a habilitar el paquete para el usuario actual; puede que el fabricante imponga restricciones.";
    const run = async () => {
      setBusyPackage(app.packageName);
      try {
        const result = await bridge.controlShizukuPackage(app.packageName, action);
        setMessage({ tone: result.success ? "good" : "bad", text: result.success ? `Acción completada para ${app.packageName}. ${result.output}` : `Android rechazó la acción (${result.exitCode ?? "sin código"}). ${result.output}` });
        await refreshStatus();
        if (result.success) await loadPackages();
        if (selected === app.packageName) await inspect(app.packageName);
      } catch (error) { setMessage({ tone: "bad", text: `No se completó la acción: ${String(error)}` }); }
      finally { setBusyPackage(""); }
    };
    Alert.alert("Confirmar acción del paquete", `¿Quieres ${verb} ${app.packageName}?\n\n${explanation}`, [
      { text: "Cancelar", style: "cancel" },
      { text: action === "disable-user" ? "Deshabilitar" : action === "force-stop" ? "Detener" : "Habilitar", style: action === "disable-user" ? "destructive" : "default", onPress: () => void run() },
    ]);
  };

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return packages.filter((item) => !value || item.packageName.toLowerCase().includes(value));
  }, [packages, query]);

  const filteredVpnTargets = useMemo(() => {
    const value = vpnQuery.trim().toLowerCase();
    return vpnTargets.filter((item) => !value || item.packageName.toLowerCase().includes(value) || item.label.toLowerCase().includes(value));
  }, [vpnTargets, vpnQuery]);

  const loadVpnTargets = async () => {
    if (!NetadbBridge) { setMessage({ tone: "warn", text: "La captura VPN solo está disponible en el APK Android." }); return; }
    setVpnLoading(true);
    try {
      const result = await NetadbBridge.listVpnTargets();
      setVpnTargets(result);
      setMessage({ tone: "good", text: `Se cargaron ${result.length} aplicaciones instaladas para seleccionar el ámbito de la VPN.` });
    } catch (error) { setMessage({ tone: "bad", text: `No se pudo cargar la lista de apps VPN: ${String(error)}` }); }
    finally { setVpnLoading(false); }
  };

  const requestVpnAccess = async () => {
    if (!NetadbBridge) return;
    try {
      const result = await NetadbBridge.requestVpnConsent();
      setMessage(result.permissionGranted
        ? { tone: "good", text: "Android ya autorizó la VPN local de NetADB." }
        : { tone: "warn", text: "Completa el consentimiento VPN de Android. Al volver a NetADB, comprueba el estado y pulsa INICIAR CAPTURA." });
      await refreshVpnStatus();
    } catch (error) { setMessage({ tone: "bad", text: `No se pudo solicitar el permiso VPN: ${String(error)}` }); }
  };

  const startLocalVpn = () => {
    const bridge = NetadbBridge;
    const target = vpnTargets.find((item) => item.packageName === vpnTargetPackage);
    if (!bridge || !target || !vpnStatus?.permissionGranted || vpnBusy || vpnStatus.otherVpnActive) return;
    Alert.alert("Iniciar VPN local", `NetADB enrutará por su túnel solo el tráfico de ${target.label} (${target.packageName}). Android mostrará una notificación persistente. Se guardan metadatos de destino, no payload, y no se descifra TLS.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "INICIAR", onPress: () => void (async () => {
        setVpnBusy(true);
        try {
          await bridge.startVpnCapture(target.packageName);
          setMessage({ tone: "warn", text: "Solicitud enviada. Espera a que el servicio VPN y el relay local indiquen ACTIVA." });
          await refreshVpnStatus();
        } catch (error) { setMessage({ tone: "bad", text: `No se pudo iniciar la VPN local: ${String(error)}` }); }
        finally { setVpnBusy(false); }
      })() },
    ]);
  };

  const stopLocalVpn = async () => {
    if (!NetadbBridge || vpnBusy) return;
    setVpnBusy(true);
    try {
      await NetadbBridge.stopVpnCapture();
      setMessage({ tone: "good", text: "Se solicitó detener la VPN. Android restaurará el enrutamiento normal al cerrarse el TUN." });
      await refreshVpnStatus();
    } catch (error) { setMessage({ tone: "bad", text: `No se pudo detener la VPN: ${String(error)}` }); }
    finally { setVpnBusy(false); }
  };

  const statusTitle = !status?.serviceRunning ? "Shizuku no está iniciado" : status.uid !== 2000 ? "UID no compatible con modo sin root" : status.permissionGranted ? "Listo · Shizuku ADB" : "Falta autorizar NetADB";
  const statusBody = !status?.serviceRunning
    ? "Inicia Shizuku en modo ADB/shell. La lista y la ficha requieren que su servicio esté activo."
    : status.uid !== 2000
      ? `Shizuku informa UID ${status.uid}. NetADB no ejecutará acciones si el backend está en root/Sui; inicia Shizuku por ADB.`
      : status.permissionGranted
        ? `Permiso concedido · UID 2000 · API ${status.apiVersion}`
        : "Shizuku está activo. Concede a NetADB su permiso de acceso para consultar el inventario.";

  return <ScreenContainer style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View style={styles.mark}><Text style={styles.markGlyph}>A</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.eyebrow}>NETADB / APP INVENTORY</Text><Text style={styles.title}>Apps y permisos</Text></View>
        <View style={[styles.pill, status?.permissionGranted && status.uid === 2000 && styles.pillActive]}><View style={[styles.dot, { backgroundColor: canUseShizuku ? C.green : C.amber }]} /><Text style={styles.pillText}>{canUseShizuku ? "READY" : "SETUP"}</Text></View>
      </View>

      <View style={styles.hero}><Text style={styles.kicker}>INSPECCIÓN ANDROID</Text><Text style={styles.heroTitle}>Ve qué está instalado.</Text><Text style={styles.body}>Consulta metadatos, permisos, componentes, AppOps y uso de red por UID. Sin inyección de procesos, sin root y sin leer el contenido de otras apps.</Text></View>

      <View style={styles.statusCard}>
        <View style={styles.statusTop}><Text style={styles.eyebrow}>ESTADO SHIZUKU</Text>{statusBusy ? <ActivityIndicator size="small" color={C.green} /> : null}</View>
        <Text style={styles.statusTitle}>{statusTitle}</Text><Text style={styles.body}>{statusBody}</Text>
        <View style={styles.buttonRow}>
          <Button label="COMPROBAR" secondary onPress={() => void refreshStatus()} disabled={statusBusy} />
          {status?.serviceRunning && status.uid === 2000 && !status.permissionGranted ? <Button label="PEDIR PERMISO" onPress={() => void requestPermission()} /> : null}
          <Button label="GUÍA SHIZUKU" secondary onPress={() => void Linking.openURL(SHIZUKU_SETUP)} />
        </View>
      </View>

      <View style={styles.notice}><Text style={styles.noticeIcon}>i</Text><Text style={styles.noticeText}>Modo sin root: Shizuku debe estar iniciado mediante ADB (UID 2000) y puede requerir reinicio tras cada reboot. Las estadísticas de tráfico son agregadas por UID: no muestran por sí solas IPs, dominios ni sockets activos.</Text></View>

      <View style={styles.card}>
        <CardTitle title="VPN local · destinos por app" note="Túnel TCP/UDP nativo con relay local; no requiere root ni Shizuku." />
        <Text style={styles.body}>Android exige consentimiento del sistema y permite una sola VPN activa por perfil. NetADB no reemplaza otra VPN en silencio. La captura se limita a la app elegida; la lista de destinos y contadores existe en memoria mientras dura la sesión y se borra al detenerla.</Text>
        {Platform.OS !== "android" ? <Text style={styles.empty}>Disponible únicamente en el APK Android. Esta vista web no puede crear una VPN del dispositivo.</Text> : null}
        {vpnStatus ? <View style={[styles.vpnStatus, vpnStatus.running && styles.vpnStatusActive]}>
          <Text style={styles.label}>ESTADO · {vpnStatus.state.toUpperCase()}</Text>
          <Text style={styles.subLabel}>{vpnStatus.message}</Text>
        </View> : <Text style={styles.empty}>Consulta el estado del servicio VPN.</Text>}
        {vpnStatus?.otherVpnActive ? <View style={styles.notice}><Text style={styles.noticeIcon}>!</Text><Text style={styles.noticeText}>Android detecta otra VPN activa. Deténla explícitamente desde Android antes de usar NetADB; NetADB no solicitará sustituirla.</Text></View> : null}
        <View style={styles.buttonRow}>
          <Button label={vpnLoading ? "CARGANDO…" : "CARGAR APPS"} secondary onPress={() => void loadVpnTargets()} disabled={!NetadbBridge || vpnLoading || vpnBusy} />
          <Button label={vpnStatus?.permissionGranted ? "VPN AUTORIZADA" : "AUTORIZAR VPN"} secondary onPress={() => void requestVpnAccess()} disabled={!NetadbBridge || vpnBusy || Boolean(vpnStatus?.otherVpnActive)} />
          <Button label={vpnBusy ? "INICIANDO…" : "INICIAR CAPTURA"} onPress={startLocalVpn} disabled={!NetadbBridge || !vpnTargetPackage || !vpnStatus?.permissionGranted || Boolean(vpnStatus?.otherVpnActive) || Boolean(vpnStatus?.running) || vpnBusy} />
          {vpnStatus?.running ? <Button label="DETENER CAPTURA" danger onPress={() => void stopLocalVpn()} disabled={vpnBusy} /> : null}
          <Button label="ACTUALIZAR" secondary onPress={() => void refreshVpnStatus()} disabled={!NetadbBridge || vpnBusy} />
        </View>
        {vpnTargets.length > 0 ? <>
          <TextInput value={vpnQuery} onChangeText={setVpnQuery} placeholder="Filtrar apps por nombre o paquete" placeholderTextColor="#64746a" autoCapitalize="none" autoCorrect={false} style={styles.input} selectionColor={C.green} />
          {filteredVpnTargets.length === 0 ? <Text style={styles.empty}>No hay coincidencias.</Text> : filteredVpnTargets.slice(0, 80).map((target) => {
            const active = vpnTargetPackage === target.packageName;
            return <Pressable key={target.packageName} onPress={() => setVpnTargetPackage(target.packageName)} style={[styles.vpnTarget, active && styles.vpnTargetActive]} accessibilityRole="button" accessibilityLabel={`Seleccionar ${target.label} para VPN`}>
              <Text style={styles.packageName}>{target.label}</Text>
              <Text style={styles.appMeta}>{target.systemApp ? "SISTEMA" : "USUARIO"} · {target.packageName}</Text>
            </Pressable>;
          })}
          {filteredVpnTargets.length > 80 ? <Text style={styles.subLabel}>Mostrando 80 de {filteredVpnTargets.length}; afina el filtro.</Text> : null}
        </> : <Text style={styles.empty}>Carga las aplicaciones instaladas y selecciona exactamente una antes de iniciar.</Text>}
        {vpnStatus?.running ? <>
          <View style={styles.infoGrid}>
            <Info label="TÚNEL · TX" value={`${formatBytes(vpnStatus.txBytes)} · ${vpnStatus.txPackets} paquetes`} />
            <Info label="TÚNEL · RX" value={`${formatBytes(vpnStatus.rxBytes)} · ${vpnStatus.rxPackets} paquetes`} />
          </View>
          <Text style={styles.subLabel}>Los bytes y paquetes son contadores globales de la interfaz TUN seleccionada y pueden no equivaler a datos entregados por una app remota. Cada CONNECT TCP es un destino solicitado; no prueba que la conexión se completara. No se intercepta ni descifra TLS.</Text>
          <View style={styles.detailBlock}>
            <Text style={styles.label}>DESTINOS OBSERVADOS · {vpnStatus.connections.length}</Text>
            {vpnStatus.connections.length === 0 ? <Text style={styles.empty}>Aún no se observaron solicitudes TCP ni datagramas UDP.</Text> : vpnStatus.connections.slice(0, 40).map((connection) => <View key={`${connection.protocol}:${connection.endpoint}`} style={styles.vpnEvent}>
              <Text selectable style={styles.packageName}>{connection.protocol.toUpperCase()} · {connection.endpoint}</Text>
              <Text style={styles.subLabel}>Visto {new Date(connection.lastSeen).toLocaleTimeString()} · eventos {connection.events}{connection.protocol === "udp" ? ` · ${formatBytes(connection.bytes)} en datagramas observados` : connection.openObserved ? " · solicitud CONNECT observada" : ""}</Text>
            </View>)}
          </View>
        </> : null}
        <Text style={styles.subLabel}>Solo metadatos de conexión. No registra contenido, no hace MITM/TLS, no prueba conexiones entrantes espontáneas y no lee la memoria de apps.</Text>
      </View>

      <View style={styles.card}>
        <CardTitle title="Inventario de paquetes" note="Por defecto muestra apps del sistema. Puedes incluir apps de usuario." />
        <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.label}>Incluir apps de usuario</Text><Text style={styles.subLabel}>Además de paquetes del sistema</Text></View><Switch value={includeUserApps} onValueChange={setIncludeUserApps} trackColor={{ false: C.border, true: "#426947" }} thumbColor={includeUserApps ? C.green : "#a8b5aa"} /></View>
        <TextInput value={query} onChangeText={setQuery} placeholder="Filtrar por nombre de paquete" placeholderTextColor="#64746a" autoCapitalize="none" autoCorrect={false} style={styles.input} selectionColor={C.green} />
        <Button label={loading ? "CARGANDO…" : "CARGAR / ACTUALIZAR"} onPress={() => void loadPackages()} disabled={loading || !canUseShizuku} />
        {loading ? <ActivityIndicator color={C.green} /> : null}
        {filtered.length === 0 ? <Text style={styles.empty}>{packages.length ? "No hay coincidencias con ese filtro." : "El inventario todavía no se ha cargado."}</Text> : filtered.slice(0, 250).map((app) => <View key={app.packageName} style={styles.appRow}>
          <Pressable onPress={() => void inspect(app.packageName)} style={{ flex: 1, gap: 4 }} accessibilityRole="button" accessibilityLabel={`Inspeccionar ${app.packageName}`}>
            <Text style={styles.packageName}>{app.packageName}</Text>
            <Text style={styles.appMeta}>{app.kind === "system" ? "SISTEMA" : "USUARIO"}{app.disabled ? " · DESHABILITADA" : " · HABILITADA"}{app.protected ? " · PROTEGIDA" : ""}</Text>
          </Pressable>
          <View style={styles.appActions}>
            <Pressable onPress={() => void inspect(app.packageName)} style={styles.miniButton}><Text style={styles.miniText}>VER</Text></Pressable>
            {app.disabled ? <Pressable disabled={Boolean(busyPackage)} onPress={() => void doAction(app, "enable")} style={styles.miniButton}><Text style={styles.miniText}>ACTIVAR</Text></Pressable> : !app.protected ? <Pressable disabled={Boolean(busyPackage)} onPress={() => void doAction(app, "disable-user")} style={[styles.miniButton, styles.miniDanger]}><Text style={[styles.miniText, { color: C.amber }]}>DESACTIVAR</Text></Pressable> : null}
            {!app.protected ? <Pressable disabled={Boolean(busyPackage)} onPress={() => void doAction(app, "force-stop")} style={styles.miniButton}><Text style={styles.miniText}>DETENER</Text></Pressable> : null}
          </View>
        </View>)}
        {filtered.length > 250 ? <Text style={styles.subLabel}>Mostrando 250 resultados; afina el filtro para los demás.</Text> : null}
      </View>

      {message ? <View style={[styles.message, message.tone === "bad" && styles.messageBad, message.tone === "warn" && styles.messageWarn]}><Text style={styles.messageText}>{message.text}</Text></View> : null}

      <View style={styles.card}>
        <CardTitle title="Inspección de solo lectura" note={selected || "Toca VER en un paquete para abrir su ficha."} />
        {inspectionBusy ? <ActivityIndicator color={C.green} /> : inspection ? <>
          <View style={styles.infoGrid}>
            <Info label="PAQUETE" value={inspection.packageName} />
            <Info label="UID" value={inspection.uid === null ? "No informado" : String(inspection.uid)} />
            <Info label="VERSIÓN" value={inspection.versionName ?? "No informada"} />
            <Info label="VERSION CODE" value={inspection.versionCode === null ? "No informado" : String(inspection.versionCode)} />
            <Info label="TARGET SDK" value={inspection.targetSdk === null ? "No informado" : String(inspection.targetSdk)} />
            <Info label="INSTALADA" value={inspection.firstInstallTime ?? "No informada"} />
            <Info label="ACTUALIZADA" value={inspection.lastUpdateTime ?? "No informada"} />
          </View>
          <View style={styles.detailBlock}><Text style={styles.label}>PERMISOS Y COMPONENTES · dumpsys package</Text><Text selectable style={styles.raw}>{inspection.packageDump || "Android no entregó datos."}</Text></View>
          <View style={styles.detailBlock}><Text style={styles.label}>APP OPS · estado devuelto por Android</Text><Text selectable style={styles.raw}>{inspection.appOps || "AppOps no disponible."}</Text>{inspection.appOpsExitCode !== 0 ? <Text style={styles.subLabel}>La consulta AppOps no terminó con código 0 ({inspection.appOpsExitCode}).</Text> : null}</View>
          <View style={styles.detailBlock}><Text style={styles.label}>TRÁFICO AGREGADO POR UID</Text><Text selectable style={styles.raw}>{inspection.networkStatsAvailable ? inspection.networkStats : "Android no entregó filas de netstats para este UID. No equivale a cero tráfico."}</Text><Text style={styles.subLabel}>No identifica destinos, dominios ni conexiones activas. Para observar endpoints se necesita captura VPN local consentida; consulta la sección VPN local anterior.</Text></View>
        </> : <Text style={styles.empty}>La ficha aparece aquí al inspeccionar un paquete del inventario.</Text>}
      </View>

      <View style={styles.card}><CardTitle title="Qué puede y qué no puede hacer" /><Text style={styles.body}>Sin root, Android no permite a NetADB leer la memoria de otra app ni inyectarse en Zygote. Shizuku puede ejecutar consultas permitidas como ADB/shell. Las acciones de detener, deshabilitar o habilitar requieren confirmación en cada caso; no hay desinstalación ni borrado de datos.</Text><Text style={styles.subLabel}>La inspección no captura paquetes ni revela el contenido cifrado TLS. Solo muestra lo que Android expone al usuario shell.</Text></View>
      <Text style={styles.footer}>NETADB · SHIZUKU + VPN / LOCAL DIAGNOSTICS</Text>
    </ScrollView>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 120, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 2 }, mark: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#203222", borderWidth: 1, borderColor: "#527f4e", alignItems: "center", justifyContent: "center" }, markGlyph: { color: C.green, fontSize: 24, fontWeight: "900", fontFamily: "monospace" }, eyebrow: { color: C.muted, fontFamily: "monospace", fontSize: 9, letterSpacing: 1.3 }, title: { color: C.text, fontSize: 19, fontWeight: "800", marginTop: 3 }, pill: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: C.border, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 7 }, pillActive: { borderColor: "#4d9444" }, dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: C.amber }, pillText: { color: C.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 0.5 },
  hero: { gap: 8, paddingTop: 8 }, kicker: { color: C.green, fontFamily: "monospace", letterSpacing: 1.2, fontSize: 10, fontWeight: "700" }, heroTitle: { color: C.text, fontSize: 29, fontWeight: "800", lineHeight: 35, letterSpacing: -0.7 }, body: { color: C.muted, fontSize: 12, lineHeight: 18 },
  statusCard: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 15, gap: 9 }, statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, statusTitle: { color: C.text, fontSize: 18, fontWeight: "700" },
  card: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 15, gap: 12 }, cardTitle: { color: C.text, fontSize: 15, fontWeight: "700" }, note: { color: C.muted, fontSize: 10, lineHeight: 15 }, buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { minHeight: 42, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.green, flexGrow: 1 }, secondary: { backgroundColor: "#203126", borderWidth: 1, borderColor: "#426947" }, danger: { backgroundColor: "#2c2021", borderWidth: 1, borderColor: "#704448" }, disabled: { opacity: 0.42 }, buttonText: { color: "#102013", fontSize: 9, fontWeight: "800", fontFamily: "monospace", letterSpacing: 0.45, textAlign: "center" }, secondaryText: { color: C.green },
  notice: { flexDirection: "row", backgroundColor: "#2c2518", borderRadius: 10, padding: 11, gap: 9, alignItems: "flex-start" }, noticeIcon: { color: C.amber, fontFamily: "monospace", fontWeight: "900" }, noticeText: { color: "#cfb889", fontSize: 10, lineHeight: 15, flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 }, label: { color: C.text, fontSize: 11, fontWeight: "700" }, subLabel: { color: C.muted, fontSize: 9, lineHeight: 14 }, input: { minHeight: 43, borderWidth: 1, borderColor: C.border, backgroundColor: "#101713", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: C.text, fontFamily: "monospace", fontSize: 11 }, empty: { color: C.muted, fontSize: 11, lineHeight: 16, paddingVertical: 5 },
  appRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10, paddingBottom: 7, gap: 9 }, packageName: { color: C.text, fontSize: 11, fontFamily: "monospace", lineHeight: 16 }, appMeta: { color: C.muted, fontSize: 8, fontFamily: "monospace", letterSpacing: 0.35 }, appActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, miniButton: { borderWidth: 1, borderColor: "#426947", backgroundColor: "#203126", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }, miniDanger: { borderColor: "#705c38", backgroundColor: "#2d2619" }, miniText: { color: C.green, fontSize: 8, fontFamily: "monospace", fontWeight: "800", letterSpacing: 0.3 },
  vpnStatus: { backgroundColor: "#1d241e", borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 11, gap: 5 }, vpnStatusActive: { backgroundColor: "#17291b", borderColor: "#4d9444" }, vpnTarget: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingVertical: 9, paddingHorizontal: 8, gap: 3 }, vpnTargetActive: { backgroundColor: "#1c3320", borderWidth: 1, borderColor: "#4d9444", borderRadius: 8 }, vpnEvent: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 9, paddingBottom: 3, gap: 4 },
  message: { backgroundColor: "#16231b", borderColor: "#315638", borderWidth: 1, borderRadius: 10, padding: 11 }, messageBad: { backgroundColor: "#2b1d20", borderColor: "#704448" }, messageWarn: { backgroundColor: "#2c2518", borderColor: "#705c38" }, messageText: { color: C.text, fontSize: 10, lineHeight: 15 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, info: { width: "48%", flexGrow: 1, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 9, gap: 4 }, infoLabel: { color: C.muted, fontSize: 8, fontFamily: "monospace", letterSpacing: 0.6 }, infoValue: { color: C.text, fontSize: 10, lineHeight: 15 }, detailBlock: { gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10 }, raw: { color: "#b9c9bc", fontFamily: "monospace", fontSize: 9, lineHeight: 14 }, footer: { color: "#536157", fontSize: 8, fontFamily: "monospace", letterSpacing: 1.2, textAlign: "center", paddingVertical: 5 },
});
