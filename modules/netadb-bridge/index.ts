import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type BridgeResult = { output: string; exitCode?: number; success?: boolean; connected?: boolean; targetSerial?: string; devices?: string[]; filePath?: string; address?: string };
export type BridgeStatus = { available: boolean; androidVersion: string; apiLevel: number };
export type ShizukuStatus = { serviceRunning: boolean; permissionGranted: boolean; uid: number; apiVersion: number };
export type ShizukuPackage = { packageName: string; kind: "system" | "user"; disabled: boolean; protected: boolean };
export type ShizukuInspection = { packageName: string; uid: number | null; versionCode: number | null; versionName: string | null; targetSdk: number | null; firstInstallTime: string | null; lastUpdateTime: string | null; packageDump: string; appOps: string; appOpsExitCode: number; networkStats: string; networkStatsAvailable: boolean };
export type ShizukuAction = "force-stop" | "disable-user" | "enable";
export type ShellState = { serial: string; state: "ready" | "closed" | "error"; message?: string; exitCode?: number };
export type VpnAppTarget = { packageName: string; label: string; systemApp: boolean };
export type VpnConnection = { protocol: "tcp" | "udp"; endpoint: string; firstSeen: number; lastSeen: number; events: number; bytes: number; openObserved: boolean };
export type VpnCaptureStatus = { permissionGranted: boolean; otherVpnActive: boolean; running: boolean; state: "idle" | "starting" | "running" | "error"; packageName: string; message: string; txPackets: number; txBytes: number; rxPackets: number; rxBytes: number; connections: VpnConnection[] };
export type NetadbNativeModule = {
  isAvailable(): Promise<BridgeStatus>;
  startDiagnosticsSession(serial: string, status: string): Promise<boolean>;
  updateDiagnosticsSession(serial: string, status: string, lines: number): Promise<boolean>;
  stopDiagnosticsSession(): Promise<boolean>;
  pair(port: string, pairingCode: string): Promise<BridgeResult>;
  pairAutomatically(pairingCode: string): Promise<BridgeResult>;
  connect(port: string): Promise<BridgeResult>;
  connectAutomatically(): Promise<BridgeResult>;
  runShell(serial: string, command: string): Promise<BridgeResult>;
  openShell(serial: string): Promise<{ ready: boolean; serial: string; output?: string }>;
  sendShellCommand(command: string): Promise<boolean>;
  closeShell(): Promise<boolean>;
  startLogcat(serial: string, buffers: string[]): string;
  stopLogcat(): boolean;
  bugreport(serial: string): Promise<BridgeResult>;
  writeExport(filename: string, contents: string): Promise<string>;
  shareFile(path: string, mimeType: "application/json" | "application/zip" | "text/plain"): Promise<boolean>;
  deleteDiagnosticFiles(): Promise<{ filesDeleted: number; bytesDeleted: number }>;
  getLicenses(): Promise<{ ladb: string; adb: string; shizuku: string; vpn: string }>;
  getVpnCaptureStatus(): Promise<VpnCaptureStatus>;
  listVpnTargets(): Promise<VpnAppTarget[]>;
  requestVpnConsent(): Promise<{ permissionGranted: boolean; promptLaunched: boolean }>;
  startVpnCapture(packageName: string): Promise<boolean>;
  stopVpnCapture(): Promise<boolean>;
  getShizukuStatus(): Promise<ShizukuStatus>;
  requestShizukuPermission(): Promise<boolean>;
  listShizukuPackages(includeUserApps: boolean): Promise<ShizukuPackage[]>;
  inspectShizukuPackage(packageName: string): Promise<ShizukuInspection>;
  controlShizukuPackage(packageName: string, action: ShizukuAction): Promise<BridgeResult>;
  addListener(eventName: "onLogLine", listener: (event: { line: string }) => void): { remove(): void };
  addListener(eventName: "onShellLine", listener: (event: { serial: string; line: string }) => void): { remove(): void };
  addListener(eventName: "onShellState", listener: (event: ShellState) => void): { remove(): void };
};

export const NetadbBridge = Platform.OS === "android"
  ? requireOptionalNativeModule<NetadbNativeModule>("NetadbBridge")
  : null;
