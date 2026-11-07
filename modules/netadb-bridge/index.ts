import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type BridgeResult = { output: string; exitCode?: number; success?: boolean; connected?: boolean; targetSerial?: string; devices?: string[]; filePath?: string };
export type BridgeStatus = { available: boolean; androidVersion: string; apiLevel: number };
export type ShellState = { serial: string; state: "ready" | "closed" | "error"; message?: string; exitCode?: number };
export type NetadbNativeModule = {
  isAvailable(): Promise<BridgeStatus>;
  startDiagnosticsSession(serial: string, status: string): Promise<boolean>;
  updateDiagnosticsSession(serial: string, status: string, lines: number): Promise<boolean>;
  stopDiagnosticsSession(): Promise<boolean>;
  pair(port: string, pairingCode: string): Promise<BridgeResult>;
  connect(port: string): Promise<BridgeResult>;
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
  getLicenses(): Promise<{ ladb: string; adb: string }>;
  addListener(eventName: "onLogLine", listener: (event: { line: string }) => void): { remove(): void };
  addListener(eventName: "onShellLine", listener: (event: { serial: string; line: string }) => void): { remove(): void };
  addListener(eventName: "onShellState", listener: (event: ShellState) => void): { remove(): void };
};

export const NetadbBridge = Platform.OS === "android"
  ? requireOptionalNativeModule<NetadbNativeModule>("NetadbBridge")
  : null;
