import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { AnimatedEntry } from "@/components/animated-entry";
import { ScreenContainer } from "@/components/screen-container";
import {
  NetadbBridge,
  type ShizukuAction,
  type ShizukuInspection,
  type ShizukuPackage,
  type ShizukuStatus,
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

function Button({
  label,
  onPress,
  disabled,
  secondary = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
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
          style={[
            styles.buttonText,
            secondary && styles.buttonTextSecondary,
            danger && styles.buttonTextDanger,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ShizukuScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const [status, setStatus] = useState<ShizukuStatus | null>(null);
  const [packages, setPackages] = useState<ShizukuPackage[]>([]);
  const [query, setQuery] = useState("");
  const [inspection, setInspection] = useState<ShizukuInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const usable =
    status?.serviceRunning === true &&
    status.uid === 2000 &&
    status.permissionGranted === true;

  const refresh = useCallback(async () => {
    if (!NetadbBridge) return;
    try {
      setStatus(await NetadbBridge.getShizukuStatus());
    } catch (error) {
      setMessage(`No se pudo consultar Shizuku: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(initial);
  }, [refresh]);

  const load = async () => {
    if (!NetadbBridge || !usable) {
      setMessage("Inicia Shizuku mediante ADB y concede el permiso a NetADB.");
      return;
    }
    setBusy(true);
    setMessage("Cargando inventario completo de paquetes mediante Shizuku…");
    try {
      const next = await NetadbBridge.listShizukuPackages(true);
      setPackages(next);
      setMessage(
        next.length
          ? `Inventario cargado: ${next.length} paquetes.`
          : "Shizuku no devolvió paquetes instalados.",
      );
    } catch (error) {
      setMessage(`No se pudo cargar el inventario: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const value = query.toLowerCase().trim();
    return packages.filter(
      (item) =>
        !value ||
        `${item.packageName} ${item.kind}`.toLowerCase().includes(value),
    );
  }, [packages, query]);

  const inspect = async (packageName: string) => {
    if (!NetadbBridge || !usable) return;
    setBusy(true);
    setMessage(`Inspeccionando ${packageName}…`);
    try {
      setInspection(await NetadbBridge.inspectShizukuPackage(packageName));
      setMessage(`Inspección lista: ${packageName}.`);
    } catch (error) {
      setMessage(`No se pudo inspeccionar ${packageName}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const action = async (name: string, command: ShizukuAction) => {
    if (!NetadbBridge || !usable) return;
    setBusy(true);
    try {
      const result = await NetadbBridge.controlShizukuPackage(name, command);
      setMessage(
        result.success === false
          ? `Falló ${command}: ${result.output}`
          : `Acción ${command} enviada a ${name}.`,
      );
      const next = await NetadbBridge.listShizukuPackages(true);
      setPackages(next);
    } catch (error) {
      setMessage(`No se pudo ejecutar ${command}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const listHeight = Math.min(360, Math.max(140, windowHeight * 0.42));

  return (
    <ScreenContainer style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.page}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        <AnimatedEntry>
          <Text style={styles.eyebrow}>NETADB / SERVICIOS ADB</Text>
          <Text style={styles.title}>SHIZUKU</Text>
          <Text style={styles.body}>
            Gestión e inspección de servicios y paquetes con autorización
            Shizuku.
          </Text>
        </AnimatedEntry>

        <AnimatedEntry delay={70}>
          <View style={styles.card}>
            <View style={styles.statusHeader}>
              <Text style={styles.serviceGlyph}>▰</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>ESTADO DEL SERVICIO</Text>
                <Text style={[styles.status, usable && styles.statusReady]}>
                  {usable ? "EN EJECUCIÓN" : "NO DISPONIBLE"}
                </Text>
              </View>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: usable ? C.green : C.amber },
                ]}
              />
            </View>
            <Text style={styles.cardBody}>
              {status?.serviceRunning
                ? `Versión ${status.apiVersion} · UID ${status.uid} · ${status.permissionGranted ? "permiso concedido" : "falta permiso"}`
                : "Inicia Shizuku mediante ADB o Wireless debugging y vuelve aquí para comprobar el servicio."}
            </Text>
            <View style={styles.row}>
              <Button
                label="COMPROBAR"
                onPress={() => void refresh()}
                secondary
              />
              <Button
                label="PEDIR PERMISO"
                onPress={() => void NetadbBridge?.requestShizukuPermission()}
                disabled={
                  !status?.serviceRunning ||
                  status.uid !== 2000 ||
                  status.permissionGranted
                }
              />
              <Button
                label="GUÍA SHIZUKU"
                onPress={() =>
                  void Linking.openURL("https://shizuku.rikka.app/guide/setup/")
                }
                secondary
              />
            </View>
          </View>
        </AnimatedEntry>

        <AnimatedEntry delay={140}>
          <View style={styles.card}>
            <View style={styles.inventoryHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>INVENTARIO DE PAQUETES</Text>
                <Text style={styles.cardBody}>
                  Sistema · usuario · paquetes instalados
                </Text>
              </View>
              <Button
                label={busy ? "CARGANDO…" : "CARGAR"}
                onPress={() => void load()}
                disabled={busy || !usable}
              />
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar paquetes…"
              placeholderTextColor={C.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.filterChips}>
              <Text style={styles.filterChipActive}>
                TODOS · {filtered.length}
              </Text>
              <Text style={styles.filterChip}>
                {packages.filter((item) => item.kind === "user").length} USUARIO
              </Text>
              <Text style={styles.filterChip}>
                {packages.filter((item) => item.kind === "system").length}{" "}
                SISTEMA
              </Text>
            </View>
            <ScrollView
              style={[styles.packageList, { height: listHeight }]}
              contentContainerStyle={styles.packageListContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {filtered.map((item) => (
                <View key={item.packageName} style={styles.packageRow}>
                  <View style={styles.packageGlyph}>
                    <Text style={styles.packageGlyphText}>
                      {item.packageName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.package} numberOfLines={1}>
                      {item.packageName.split(".").pop() || item.packageName}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {item.packageName}
                    </Text>
                  </View>
                  <Text style={styles.kindPill}>
                    {item.kind === "user" ? "USUARIO" : "SISTEMA"}
                  </Text>
                  <Button
                    label="VER"
                    onPress={() => void inspect(item.packageName)}
                    disabled={busy || !usable}
                    secondary
                  />
                  <Button
                    label="DETENER"
                    onPress={() => void action(item.packageName, "force-stop")}
                    disabled={busy || !usable}
                    danger
                  />
                </View>
              ))}
              {packages.length > 0 && filtered.length === 0 ? (
                <Text style={styles.empty}>
                  No hay coincidencias con el filtro.
                </Text>
              ) : null}
              {packages.length === 0 && !busy ? (
                <Text style={styles.empty}>
                  Pulsa CARGAR para consultar el inventario.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </AnimatedEntry>

        {inspection ? (
          <AnimatedEntry delay={190}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>INSPECCIÓN DE PAQUETE</Text>
              <Text style={styles.package}>{inspection.packageName}</Text>
              <View style={styles.detailGrid}>
                <Text style={styles.detail}>UID · {inspection.uid ?? "—"}</Text>
                <Text style={styles.detail}>
                  VERSIÓN · {inspection.versionName ?? "—"}
                </Text>
                <Text style={styles.detail}>
                  TARGET SDK · {inspection.targetSdk ?? "—"}
                </Text>
              </View>
              <Text selectable style={styles.mono}>
                {inspection.packageDump}
              </Text>
              <Text selectable style={styles.mono}>
                {inspection.appOps}
              </Text>
              <Text selectable style={styles.mono}>
                {inspection.networkStats}
              </Text>
            </View>
          </AnimatedEntry>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}
        <ActivityIndicator animating={busy} color={C.green} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  page: { padding: 18, paddingBottom: 38, gap: 14 },
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
    padding: 14,
    gap: 10,
  },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  serviceGlyph: { color: C.green, fontSize: 24, fontWeight: "800" },
  cardTitle: {
    color: C.text,
    fontWeight: "800",
    letterSpacing: 0.6,
    fontSize: 13,
  },
  cardBody: { color: C.muted, fontSize: 11, lineHeight: 16 },
  status: { color: C.amber, fontSize: 13, fontWeight: "800", marginTop: 3 },
  statusReady: { color: C.green },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" },
  button: {
    backgroundColor: C.green,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 10,
    minHeight: 36,
    justifyContent: "center",
  },
  buttonSecondary: {
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.border,
  },
  buttonDanger: {
    backgroundColor: "#2c2021",
    borderWidth: 1,
    borderColor: "#704448",
  },
  disabled: { opacity: 0.42 },
  buttonText: { color: C.bg, fontWeight: "800", fontSize: 9 },
  buttonTextSecondary: { color: C.green },
  buttonTextDanger: { color: C.red },
  inventoryHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    backgroundColor: C.panel2,
    color: C.text,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    minHeight: 44,
  },
  filterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  filterChip: {
    color: C.muted,
    backgroundColor: C.panel2,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 8,
    overflow: "hidden",
  },
  filterChipActive: {
    color: C.bg,
    backgroundColor: C.green,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 8,
    fontWeight: "900",
    overflow: "hidden",
  },
  packageList: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: "#101713",
    flexGrow: 0,
    flexShrink: 1,
  },
  packageListContent: { padding: 6 },
  packageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 52,
    paddingVertical: 6,
    borderBottomColor: C.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  packageGlyph: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: "#203126",
    alignItems: "center",
    justifyContent: "center",
  },
  packageGlyphText: { color: C.green, fontWeight: "800" },
  package: { color: C.text, fontWeight: "700", fontSize: 11 },
  kindPill: {
    color: C.muted,
    fontSize: 7,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: C.panel2,
    borderRadius: 8,
  },
  muted: { color: C.muted, fontSize: 8, marginTop: 2 },
  empty: { color: C.muted, padding: 14, fontSize: 11, textAlign: "center" },
  detailGrid: { gap: 4 },
  detail: { color: C.muted, fontSize: 10 },
  mono: {
    color: C.muted,
    fontFamily: "monospace",
    fontSize: 9,
    lineHeight: 14,
    backgroundColor: "#101713",
    padding: 8,
    borderRadius: 8,
  },
  message: { color: C.amber, fontSize: 10, lineHeight: 15 },
});
