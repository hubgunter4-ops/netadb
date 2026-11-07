import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { NetadbBridge } from "@/modules/netadb-bridge";

const bg = "#111814";
const green = "#7cff6b";
const muted = "#a5b3a8";

export default function LicensesScreen() {
  const [licenses, setLicenses] = useState<{ ladb: string; adb: string; shizuku: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (Platform.OS !== "android" || !NetadbBridge) {
      setError("El texto completo de licencias está disponible en el APK Android y en el directorio modules/netadb-bridge del código fuente.");
      return;
    }
    NetadbBridge.getLicenses().then(setLicenses).catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <ScreenContainer containerClassName="bg-[#111814]" safeAreaClassName="bg-[#111814]" style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Link href="/" style={styles.back}>← Volver al diagnóstico</Link>
        <Text style={styles.kicker}>TRANSPARENCIA · TERCEROS</Text>
        <Text style={styles.title}>Licencias</Text>
        <Text style={styles.copy}>NetADB conserva los avisos de los componentes ADB redistribuidos. No se autoriza subir esta app a Google Play Store.</Text>
        {error ? <Text style={styles.copy}>{error}</Text> : null}
        {!licenses && !error ? <ActivityIndicator color={green} /> : null}
        {licenses ? <>
          <Text style={styles.heading}>LADB · licencia y condiciones</Text>
          <View style={styles.licenseBox}><Text selectable style={styles.license}>{licenses.ladb}</Text></View>
          <Text style={styles.heading}>Ejecutable ADB · Apache 2.0</Text>
          <View style={styles.licenseBox}><Text selectable style={styles.license}>{licenses.adb}</Text></View>
          <Text style={styles.heading}>Shizuku API · licencia MIT</Text>
          <View style={styles.licenseBox}><Text selectable style={styles.license}>{licenses.shizuku}</Text></View>
        </> : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: bg }, page: { padding: 18, gap: 14, paddingBottom: 36 }, back: { color: green, fontSize: 12, marginBottom: 8 }, kicker: { color: green, fontFamily: "monospace", fontSize: 10, letterSpacing: 1.3 }, title: { color: "#e7f3e7", fontSize: 28, fontWeight: "800" }, copy: { color: muted, fontSize: 12, lineHeight: 18 }, heading: { color: green, fontSize: 14, fontWeight: "700", marginTop: 12 }, licenseBox: { backgroundColor: "#18221c", borderColor: "#2c4130", borderWidth: 1, borderRadius: 12, padding: 12 }, license: { color: "#d7e4d9", fontFamily: "monospace", fontSize: 9, lineHeight: 14 }, });
