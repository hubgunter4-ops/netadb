import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { AnimatedEntry } from "@/components/animated-entry";
import {
  NetadbBridge,
  type VpnAppTarget,
  type VpnCaptureStatus,
} from "@/modules/netadb-bridge";

const C = {
  bg: "#111814",
  panel: "#18221c",
  panel2: "#1d2a22",
  border: "#2c4130",
  text: "#e7f3e7",
  muted: "#90a394",
  green: "#7cff6b",
  amber: "#ffbe55",
  red: "#ff666d",
};

type TrafficSample = { tx: number; rx: number };

function formatBytes(value: number) {
  const bytes = Math.max(0, value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount.toFixed(1)} ${units[index]}`;
}

function Button({
  label,
  onPress,
  disabled,
  danger = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  secondary?: boolean;
}) {
  const scale = useMemo(() => new Animated.Value(1), []);
  const animate = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 30,
      bounciness: 5,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animate(0.96)}
        onPressOut={() => animate(1)}
        style={[
          styles.button,
          secondary && styles.buttonSecondary,
          danger && styles.buttonDanger,
          disabled && styles.disabled,
        ]}
      >
        <Text
          style={[styles.buttonText, secondary && styles.buttonTextSecondary]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function VpnScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const [status, setStatus] = useState<VpnCaptureStatus | null>(null);
  const [targets, setTargets] = useState<VpnAppTarget[]>([]);
  const [selected, setSelected] = useState("");
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [trafficQuery, setTrafficQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [message, setMessage] = useState("");
  const [trafficSamples, setTrafficSamples] = useState<TrafficSample[]>([]);
  const pulse = useMemo(() => new Animated.Value(1), []);
  const refreshInFlight = useRef(false);
  const lastTraffic = useRef<{ tx: number; rx: number; at: number } | null>(
    null,
  );

  const applyStatus = useCallback((next: VpnCaptureStatus) => {
    setStatus(next);
    if (next.running) {
      const previous = lastTraffic.current;
      const capturedAt = Date.now();
      if (previous) {
        const elapsed = Math.max(1, capturedAt - previous.at);
        setTrafficSamples((items) =>
          [
            ...items,
            {
              tx: Math.round(
                (Math.max(0, next.txBytes - previous.tx) * 1000) / elapsed,
              ),
              rx: Math.round(
                (Math.max(0, next.rxBytes - previous.rx) * 1000) / elapsed,
              ),
            },
          ].slice(-32),
        );
      }
      lastTraffic.current = {
        tx: next.txBytes,
        rx: next.rxBytes,
        at: capturedAt,
      };
      if (next.packageName) setSelected(next.packageName);
    } else {
      lastTraffic.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!NetadbBridge || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      applyStatus(await NetadbBridge.getVpnCaptureStatus());
    } catch (error) {
      setMessage(`No se pudo leer el estado VPN: ${String(error)}`);
    } finally {
      refreshInFlight.current = false;
    }
  }, [applyStatus]);

  const loadTargets = useCallback(async () => {
    if (!NetadbBridge) {
      setMessage(
        "La carga de aplicaciones requiere el APK Android con el puente nativo.",
      );
      return;
    }
    setLoadingTargets(true);
    setMessage("Cargando inventario completo de aplicaciones instaladas…");
    try {
      const next = await NetadbBridge.listVpnTargets();
      setTargets(next);
      setSelected((current) => {
        return current && next.some((item) => item.packageName === current)
          ? current
          : "";
      });
      setMessage(
        next.length
          ? `Inventario cargado: ${next.length} aplicaciones disponibles.`
          : "Android no devolvió aplicaciones instaladas. Revisa QUERY_ALL_PACKAGES y reinstala el APK actualizado.",
      );
    } catch (error) {
      setMessage(`No se pudieron cargar las aplicaciones: ${String(error)}`);
    } finally {
      setLoadingTargets(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => {
      void refresh();
      void loadTargets();
    }, 0);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearTimeout(initial);
      subscription.remove();
    };
  }, [loadTargets, refresh]);

  useEffect(() => {
    if (status?.state !== "starting" && !status?.running) return;
    const timer = setInterval(
      () => void refresh(),
      status?.state === "starting" ? 600 : 1000,
    );
    return () => clearInterval(timer);
  }, [refresh, status?.running, status?.state]);

  useEffect(() => {
    if (!status?.running) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, status?.running]);

  const filteredTargets = useMemo(() => {
    const value = query.toLowerCase().trim();
    return targets.filter(
      (item) =>
        !value ||
        `${item.label} ${item.packageName}`.toLowerCase().includes(value),
    );
  }, [targets, query]);
  const connections = useMemo(() => {
    const value = trafficQuery.toLowerCase().trim();
    return (status?.connections ?? []).filter(
      (item) =>
        !value ||
        `${item.domain ?? ""} ${item.endpoint} ${item.protocol}`
          .toLowerCase()
          .includes(value),
    );
  }, [status?.connections, trafficQuery]);
  const domains = useMemo(
    () => [
      ...new Set(
        connections
          .map((item) => item.domain)
          .filter((item): item is string => Boolean(item)),
      ),
    ],
    [connections],
  );
  const allDomains = useMemo(
    () => [
      ...new Set(
        (status?.connections ?? [])
          .map((item) => item.domain)
          .filter((item): item is string => Boolean(item)),
      ),
    ],
    [status?.connections],
  );
  const selectedTarget = useMemo(
    () => targets.find((item) => item.packageName === selected) ?? null,
    [selected, targets],
  );

  const authorize = async () => {
    if (!NetadbBridge) return;
    try {
      const result = await NetadbBridge.requestVpnConsent();
      setMessage(
        result.promptLaunched
          ? "Completa el consentimiento VPN de Android y vuelve a NetADB. El estado se actualizará al regresar."
          : "Permiso VPN de Android concedido. Ya puedes iniciar la captura.",
      );
      await refresh();
    } catch (error) {
      setMessage(`No se pudo autorizar la VPN: ${String(error)}`);
      await refresh();
    }
  };

  const start = async () => {
    if (!NetadbBridge || !selected || busy) return;
    if (status?.otherVpnActive) {
      setMessage(
        "Android detectó otra VPN activa. Detén esa VPN antes de iniciar NetADB.",
      );
      return;
    }
    setBusy(true);
    setMessage(`Solicitando VPN para ${selected}…`);
    try {
      await NetadbBridge.startVpnCapture(selected);
      setMessage("Android está preparando el túnel. Esperando confirmación…");
      for (let attempt = 0; attempt < 30; attempt++) {
        await wait(500);
        const next = await NetadbBridge.getVpnCaptureStatus();
        applyStatus(next);
        if (next.state === "running" && next.running) {
          setMessage(`VPN activa para ${selected}.`);
          return;
        }
        if (next.state === "error") {
          setMessage(`La VPN no inició: ${next.message}`);
          return;
        }
        if (next.state === "idle" && attempt > 10) {
          setMessage(`Android no confirmó el inicio. Estado: ${next.message}`);
          return;
        }
      }
      const finalStatus = await NetadbBridge.getVpnCaptureStatus();
      applyStatus(finalStatus);
      setMessage(
        finalStatus.running
          ? `VPN activa para ${selected}.`
          : `Tiempo de espera agotado. Estado: ${finalStatus.message || finalStatus.state}. Revisa el mensaje del sistema y vuelve a intentar.`,
      );
    } catch (error) {
      setMessage(`Falló el inicio de la VPN: ${String(error)}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!NetadbBridge || busy) return;
    setBusy(true);
    setMessage("Deteniendo la captura VPN…");
    try {
      await NetadbBridge.stopVpnCapture();
      await wait(350);
      await refresh();
      setMessage(
        "Captura VPN detenida. Android restableció el enrutamiento normal.",
      );
    } catch (error) {
      setMessage(`No se pudo detener la VPN: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleVpn = (enabled: boolean) => {
    if (!enabled) {
      void stop();
      return;
    }
    if (!status?.permissionGranted) {
      void authorize();
      return;
    }
    if (!selected) {
      setShowAppPicker(true);
      setMessage(
        "Selecciona una app objetivo. La VPN no depende del shell ADB.",
      );
      return;
    }
    void start();
  };

  const exportLog = async (format: "json" | "csv") => {
    if (!NetadbBridge || !status?.running) {
      setMessage("Inicia la VPN y genera tráfico antes de exportar.");
      return;
    }
    const exportedAt = new Date().toISOString();
    const rows = status.connections.map((item) => ({
      ...item,
      firstSeen: new Date(item.firstSeen).toISOString(),
      lastSeen: new Date(item.lastSeen).toISOString(),
      bytesHuman: formatBytes(item.bytes),
    }));
    const contents =
      format === "json"
        ? JSON.stringify(
            {
              product: "NetADB",
              tool: "VPN",
              exportedAt,
              scope: "metadata-only",
              packageName: status.packageName,
              totals: {
                txPackets: status.txPackets,
                txBytes: status.txBytes,
                txBytesHuman: formatBytes(status.txBytes),
                rxPackets: status.rxPackets,
                rxBytes: status.rxBytes,
                rxBytesHuman: formatBytes(status.rxBytes),
              },
              domains: allDomains,
              connections: rows,
            },
            null,
            2,
          )
        : [
            [
              "exportedAt",
              "packageName",
              "protocol",
              "domain",
              "endpoint",
              "firstSeen",
              "lastSeen",
              "events",
              "bytes",
              "bytesHuman",
            ],
            ...rows.map((item) => [
              exportedAt,
              status.packageName,
              item.protocol,
              item.domain,
              item.endpoint,
              item.firstSeen,
              item.lastSeen,
              item.events,
              item.bytes,
              item.bytesHuman,
            ]),
          ]
            .map((row) => row.map(csvCell).join(","))
            .join("\n") + "\n";
    try {
      const path = await NetadbBridge.writeExport(
        `netadb-vpn-${Date.now()}.${format}`,
        contents,
      );
      await NetadbBridge.shareFile(
        path,
        format === "json" ? "application/json" : "text/csv",
      );
      setMessage(`Exportación ${format.toUpperCase()} preparada.`);
    } catch (error) {
      setMessage(`No se pudo exportar: ${String(error)}`);
    }
  };

  const maxTraffic = Math.max(
    1,
    ...trafficSamples.flatMap((sample) => [sample.tx, sample.rx]),
  );
  const currentTraffic = trafficSamples[trafficSamples.length - 1] ?? {
    tx: 0,
    rx: 0,
  };
  const listHeight = Math.min(320, Math.max(120, windowHeight * 0.36));
  const stateLabel = status?.running
    ? "ACTIVA"
    : status?.state === "starting"
      ? "INICIANDO"
      : status?.state === "error"
        ? "ERROR"
        : "DETENIDA";
  const startHint = status?.otherVpnActive
    ? "Detén la otra VPN desde Android para liberar el servicio."
    : !status?.permissionGranted
      ? "Autoriza la VPN de Android antes de iniciar la captura."
      : !selected
        ? "Selecciona una aplicación instalada en la lista."
        : "El túnel se limitará únicamente a la aplicación seleccionada.";

  return (
    <ScreenContainer style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <AnimatedEntry>
          <Text style={styles.eyebrow}>NETADB / HERRAMIENTA VPN</Text>
          <Text style={styles.title}>VPN</Text>
          <Text style={styles.body}>
            Túnel VPN local de Android para una app elegida, independiente del
            shell ADB. No es un servidor VPN remoto ni descifra TLS.
          </Text>
        </AnimatedEntry>

        <AnimatedEntry delay={60}>
          <View style={styles.card}>
            <View style={styles.statusLine}>
              <View style={styles.statusIdentity}>
                <Text style={styles.powerIcon}>◉</Text>
                <View>
                  <Text style={styles.cardTitle}>ESTADO DE LA VPN</Text>
                  <Text
                    style={[
                      styles.status,
                      status?.running && styles.statusActive,
                      status?.state === "error" && styles.statusError,
                    ]}
                  >
                    {stateLabel}
                  </Text>
                </View>
              </View>
              {status?.running ? (
                <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
              ) : null}
              <Switch
                accessibilityLabel="Activar o detener la VPN local"
                value={Boolean(status?.running || status?.state === "starting")}
                onValueChange={toggleVpn}
                disabled={busy || !NetadbBridge}
                trackColor={{ false: "#405046", true: "#3e8f48" }}
                thumbColor={status?.running ? C.green : "#a8b7ac"}
              />
            </View>
            <Text style={styles.cardBody}>
              {status?.message ??
                "Autoriza el servicio VPN de Android y selecciona una aplicación objetivo."}
            </Text>
            {status?.otherVpnActive ? (
              <Text style={styles.errorNotice}>
                Otra VPN está activa. Android permite una VPN local a la vez.
              </Text>
            ) : null}
            {message ? (
              <Text selectable style={styles.message}>
                {message}
              </Text>
            ) : null}
            <View style={styles.row}>
              <Button
                label="AUTORIZAR VPN"
                onPress={() => void authorize()}
                disabled={busy || !NetadbBridge}
                secondary
              />
              <Button
                label="ACTUALIZAR"
                onPress={() => void refresh()}
                disabled={busy || !NetadbBridge}
                secondary
              />
            </View>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={120}>
          <View style={styles.card}>
            <View style={styles.sectionHeading}>
              <Text style={styles.appIcon}>▦</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>APLICACIÓN SELECCIONADA</Text>
                <Text style={styles.cardBody}>
                  Selección VPN independiente de ADB.
                </Text>
              </View>
              <Button
                label={
                  selected
                    ? "CAMBIAR"
                    : loadingTargets
                      ? "CARGANDO…"
                      : "CARGAR APPS"
                }
                onPress={() =>
                  selected
                    ? setShowAppPicker((visible) => !visible)
                    : void loadTargets()
                }
                disabled={loadingTargets || !NetadbBridge}
                secondary
              />
            </View>
            {selected && !showAppPicker ? (
              <View style={styles.selectedAppCard}>
                <View style={styles.appGlyph}>
                  <Text style={styles.appGlyphText}>
                    {selectedTarget?.label.trim().slice(0, 1).toUpperCase() ||
                      "A"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.appTitle} numberOfLines={1}>
                    {selectedTarget?.label ?? "Aplicación seleccionada"}
                  </Text>
                  <Text style={styles.appPackage} numberOfLines={1}>
                    {selected}
                  </Text>
                </View>
                <Text style={styles.appKind}>
                  {selectedTarget?.systemApp ? "SISTEMA" : "USUARIO"}
                </Text>
              </View>
            ) : null}
            {showAppPicker || !selected ? (
              <>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar aplicación o paquete…"
                  placeholderTextColor={C.muted}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ScrollView
                  style={[styles.list, { height: listHeight }]}
                  contentContainerStyle={styles.listContent}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {filteredTargets.map((item) => (
                    <Pressable
                      key={item.packageName}
                      accessibilityRole="button"
                      accessibilityLabel={`Seleccionar ${item.label}`}
                      onPress={() => {
                        setSelected(item.packageName);
                        setShowAppPicker(false);
                      }}
                      style={[
                        styles.appRow,
                        selected === item.packageName && styles.appRowSelected,
                      ]}
                    >
                      <View
                        style={[
                          styles.appGlyph,
                          item.systemApp && styles.appGlyphSystem,
                        ]}
                      >
                        <Text style={styles.appGlyphText}>
                          {item.label.trim().slice(0, 1).toUpperCase() || "A"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.appTitle} numberOfLines={1}>
                          {item.label}
                        </Text>
                        <Text style={styles.appPackage} numberOfLines={1}>
                          {item.packageName}
                        </Text>
                      </View>
                      <Text style={styles.appKind}>
                        {item.systemApp ? "SISTEMA" : "USUARIO"}
                      </Text>
                    </Pressable>
                  ))}
                  {targets.length > 0 && filteredTargets.length === 0 ? (
                    <Text style={styles.empty}>
                      No hay aplicaciones que coincidan con el filtro.
                    </Text>
                  ) : null}
                  {targets.length === 0 && !loadingTargets ? (
                    <Text style={styles.empty}>
                      No se cargó el inventario. Pulsa “CARGAR APPS” para
                      reintentar.
                    </Text>
                  ) : null}
                </ScrollView>
              </>
            ) : null}
            <Text style={styles.cardBody}>
              {targets.length
                ? `${filteredTargets.length} de ${targets.length} apps · lista desplazable`
                : loadingTargets
                  ? "Consultando Package Manager…"
                  : "Inventario aún no disponible."}
              {selected
                ? `\nObjetivo: ${selected}`
                : "\nSelecciona una app para iniciar."}
            </Text>
            {!status?.running ? (
              <Text
                style={
                  status?.otherVpnActive ? styles.errorNotice : styles.cardBody
                }
              >
                {startHint}
              </Text>
            ) : null}
            {loadingTargets ? <ActivityIndicator color={C.green} /> : null}
            <View style={styles.row}>
              {status?.running ? (
                <Button
                  label="DETENER VPN"
                  danger
                  onPress={() => void stop()}
                  disabled={busy}
                />
              ) : (
                <Button
                  label={busy ? "INICIANDO…" : "INICIAR CAPTURA"}
                  onPress={() => void start()}
                  disabled={
                    busy ||
                    !selected ||
                    !status?.permissionGranted ||
                    Boolean(status?.otherVpnActive)
                  }
                />
              )}
            </View>
          </View>
        </AnimatedEntry>

        {status?.running ? (
          <AnimatedEntry delay={180}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>TRÁFICO EN TIEMPO REAL</Text>
              <View style={styles.trafficStats}>
                <View style={styles.trafficMetric}>
                  <Text style={styles.cardBody}>TX · SUBIDA</Text>
                  <Text style={styles.trafficValue}>
                    {formatBytes(currentTraffic.tx)}/s
                  </Text>
                  <Text style={styles.cardBody}>
                    TOTAL {formatBytes(status.txBytes)} · {status.txPackets}{" "}
                    paquetes
                  </Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.trafficMetric}>
                  <Text style={styles.cardBody}>RX · DESCARGA</Text>
                  <Text style={styles.trafficValue}>
                    {formatBytes(currentTraffic.rx)}/s
                  </Text>
                  <Text style={styles.cardBody}>
                    TOTAL {formatBytes(status.rxBytes)} · {status.rxPackets}{" "}
                    paquetes
                  </Text>
                </View>
              </View>
              <View style={styles.chartHeader}>
                <Text style={styles.cardBody}>ACTIVIDAD RECIENTE</Text>
                <Text style={styles.chartLegend}>TX · RX</Text>
              </View>
              <View style={styles.chart}>
                {trafficSamples.map((sample, index) => (
                  <View key={`sample-${index}`} style={styles.chartColumn}>
                    <View
                      style={[
                        styles.chartBarTx,
                        { height: Math.max(3, (sample.tx / maxTraffic) * 72) },
                      ]}
                    />
                    <View
                      style={[
                        styles.chartBarRx,
                        { height: Math.max(3, (sample.rx / maxTraffic) * 72) },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <Text style={styles.cardBody}>
                Solo se registra metadata de conexión; no se inspecciona
                contenido TLS.
              </Text>
            </View>
          </AnimatedEntry>
        ) : null}

        {status?.running ? (
          <AnimatedEntry delay={240}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                DOMINIOS RESUELTOS Y DESTINOS
              </Text>
              <TextInput
                value={trafficQuery}
                onChangeText={setTrafficQuery}
                placeholder="Filtrar dominio, IP, puerto o protocolo"
                placeholderTextColor={C.muted}
                style={styles.input}
                autoCapitalize="none"
              />
              <Text style={styles.cardBody}>DOMINIOS · {domains.length}</Text>
              {domains.length ? (
                domains.map((domain) => (
                  <Text key={domain} style={styles.domain}>
                    {domain}
                  </Text>
                ))
              ) : (
                <Text style={styles.cardBody}>
                  Aún no se observaron dominios en esta sesión.
                </Text>
              )}
              <Text style={styles.cardBody}>
                DESTINOS · {connections.length}
              </Text>
              {connections.slice(0, 80).map((item) => (
                <View
                  key={`${item.protocol}:${item.endpoint}`}
                  style={styles.event}
                >
                  <Text style={styles.appTitle}>
                    {item.protocol.toUpperCase()} ·{" "}
                    {item.domain ? `${item.domain} · ` : ""}
                    {item.endpoint}
                  </Text>
                  <Text style={styles.appPackage}>
                    {item.events} eventos · {formatBytes(item.bytes)} ·{" "}
                    {new Date(item.lastSeen).toLocaleTimeString()}
                  </Text>
                </View>
              ))}
              <View style={styles.row}>
                <Button
                  label="EXPORTAR JSON"
                  onPress={() => void exportLog("json")}
                  secondary
                />
                <Button
                  label="EXPORTAR CSV"
                  onPress={() => void exportLog("csv")}
                  secondary
                />
              </View>
            </View>
          </AnimatedEntry>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  page: { padding: 18, paddingBottom: 40, gap: 14 },
  eyebrow: {
    color: C.green,
    letterSpacing: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  title: { color: C.text, fontSize: 28, fontWeight: "800", marginTop: 4 },
  body: { color: C.muted, lineHeight: 19, marginTop: 4 },
  card: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    gap: 11,
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusIdentity: { flexDirection: "row", alignItems: "center", gap: 11 },
  powerIcon: { color: C.green, fontSize: 24, fontWeight: "800" },
  appIcon: { color: C.green, fontSize: 22, fontWeight: "800" },
  cardTitle: {
    color: C.text,
    fontWeight: "800",
    letterSpacing: 0.6,
    fontSize: 14,
  },
  cardBody: { color: C.muted, fontSize: 11, lineHeight: 16 },
  status: { color: C.amber, fontSize: 16, fontWeight: "800", marginTop: 3 },
  statusActive: { color: C.green },
  statusError: { color: C.red },
  liveDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.green },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  button: {
    backgroundColor: C.green,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 13,
    minHeight: 42,
    justifyContent: "center",
  },
  buttonSecondary: {
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: "#426947",
  },
  buttonDanger: {
    backgroundColor: "#2c2021",
    borderWidth: 1,
    borderColor: "#704448",
  },
  disabled: { opacity: 0.42 },
  buttonText: {
    color: C.bg,
    fontWeight: "800",
    fontSize: 11,
    textAlign: "center",
  },
  buttonTextSecondary: { color: C.green },
  message: { color: C.amber, fontSize: 11, lineHeight: 16 },
  errorNotice: {
    color: C.red,
    backgroundColor: "#2c2021",
    borderRadius: 9,
    padding: 10,
    fontSize: 11,
    lineHeight: 16,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    backgroundColor: C.panel2,
    color: C.text,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 11,
    padding: 12,
    minHeight: 46,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: "#101713",
  },
  listContent: { padding: 7, gap: 5 },
  selectedAppCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 11,
    borderWidth: 1,
    borderColor: "#426947",
    borderRadius: 12,
    backgroundColor: "#203126",
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 56,
    padding: 8,
    borderColor: "transparent",
    borderWidth: 1,
    borderRadius: 10,
  },
  appRowSelected: { borderColor: "#4d9444", backgroundColor: "#203126" },
  appGlyph: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#183020",
  },
  appGlyphSystem: { backgroundColor: "#203126" },
  appGlyphText: { color: C.green, fontWeight: "800", fontSize: 15 },
  appTitle: { color: C.text, fontWeight: "700", fontSize: 12 },
  appPackage: { color: C.muted, fontSize: 10, marginTop: 2 },
  appKind: { color: C.muted, fontSize: 8, fontWeight: "700" },
  empty: { color: C.muted, padding: 14, fontSize: 12, textAlign: "center" },
  trafficStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 5,
  },
  trafficMetric: { flex: 1, gap: 3 },
  metricDivider: { width: 1, alignSelf: "stretch", backgroundColor: C.border },
  trafficValue: {
    color: C.green,
    fontSize: 19,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chartLegend: { color: C.green, fontSize: 9, fontWeight: "700" },
  chart: {
    height: 85,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    paddingHorizontal: 3,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  chartColumn: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 1,
  },
  chartBarTx: {
    width: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: C.green,
  },
  chartBarRx: {
    width: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: C.amber,
  },
  domain: { color: C.green, fontSize: 13, paddingVertical: 4 },
  event: {
    borderTopColor: C.border,
    borderTopWidth: 1,
    paddingVertical: 9,
    gap: 2,
  },
});
