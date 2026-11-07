import { describe, expect, it } from "vitest";
import { compareSnapshots } from "../lib/diagnostics/snapshot-diff";

const snapshot = (capturedAt: string, files: Record<string, string>, errors: string[] = []) => ({ capturedAt, files, errors });

describe("compareSnapshots", () => {
  it("ignores capture timestamps and reports added/removed network lines by category", () => {
    const base = snapshot("2026-01-01T00:00:00Z", {
      "connectivity.txt": "# Captured UTC: old\nNetworkAgentInfo: CONNECTED\nDNS server 1.1.1.1\n",
    });
    const current = snapshot("2026-01-01T00:01:00Z", {
      "connectivity.txt": "# Captured UTC: new\nNetworkAgentInfo: DISCONNECTED\nDNS server 8.8.8.8\n",
    });
    const diff = compareSnapshots(base, current);
    expect(diff.addedCount).toBe(2);
    expect(diff.removedCount).toBe(2);
    expect(diff.sources[0].categories).toMatchObject({ DNS: 2, Conectividad: 2 });
    expect(diff.sources[0].added.map((item) => item.line)).toContain("DNS server 8.8.8.8");
  });

  it("preserves missing sources and capture errors without mutating inputs", () => {
    const base = snapshot("base", { "wifi.txt": "SSID: office" }, ["dns: denied"]);
    const current = snapshot("new", { "connectivity.txt": "validated=true" }, ["wifi: timeout"]);
    const diff = compareSnapshots(base, current);
    expect(diff.sources.find((source) => source.source === "wifi.txt")?.missingFromCurrent).toBe(true);
    expect(diff.sources.find((source) => source.source === "connectivity.txt")?.missingFromBase).toBe(true);
    expect(diff.baseErrors).toEqual(["dns: denied"]);
    expect(diff.currentErrors).toEqual(["wifi: timeout"]);
    expect(base.files).toEqual({ "wifi.txt": "SSID: office" });
  });

  it("returns no content changes for identical files", () => {
    const value = snapshot("same", { "wifi.txt": "wlan0 UP" });
    const diff = compareSnapshots(value, value);
    expect(diff.changedSources).toBe(0);
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
  });
});
