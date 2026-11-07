import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform } from "react-native";
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  return <Tabs screenOptions={{ headerShown: false, tabBarButton: HapticTab, tabBarActiveTintColor: "#83FF70", tabBarInactiveTintColor: "#77857B", tabBarStyle: { paddingTop: 7, paddingBottom: bottomPadding, height: 56 + bottomPadding, backgroundColor: "#0B100D", borderTopColor: "#26382B", borderTopWidth: 0.5 } }}>
    <Tabs.Screen name="diagnostics" options={{ title: "Herramientas", tabBarIcon: ({ color }) => <IconSymbol size={24} name="waveform.path.ecg" color={color} /> }} />
    <Tabs.Screen name="index" options={{ title: "ADB / NetADB", tabBarIcon: ({ color }) => <IconSymbol size={25} name="terminal.fill" color={color} /> }} />
    <Tabs.Screen name="vpn" options={{ title: "VPN", tabBarIcon: ({ color }) => <IconSymbol size={24} name="paperplane.fill" color={color} /> }} />
    <Tabs.Screen name="shizuku" options={{ title: "Shizuku", tabBarIcon: ({ color }) => <IconSymbol size={24} name="square.grid.2x2.fill" color={color} /> }} />
    <Tabs.Screen name="apps" options={{ href: null }} />
    <Tabs.Screen name="licenses" options={{ title: "Licencias", tabBarIcon: ({ color }) => <IconSymbol size={24} name="doc.text" color={color} /> }} />
  </Tabs>;
}
