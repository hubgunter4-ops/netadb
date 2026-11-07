import { describe, expect, it } from "vitest";
import { classifyLogcatLine, parseExternalInboundConntrack } from "../lib/diagnostics/parser";

describe("classifyLogcatLine", () => {
  it("marks Wi-Fi losses without claiming an external cause", () => {
    expect(classifyLogcatLine("Wifi network lost"))?.toMatchObject({ label: "WIFI / PÉRDIDA", tone: "yellow" });
  });
  it("classifies DNS events", () => {
    expect(classifyLogcatLine("DnsResolver query completed"))?.toMatchObject({ label: "DNS", tone: "cyan" });
  });
  it("ignores unrelated lines", () => {
    expect(classifyLogcatLine("routine scheduler tick")).toBeNull();
  });
});

describe("parseExternalInboundConntrack", () => {
  const inbound = "tcp 6 431999 ESTABLISHED src=8.8.8.8 dst=192.168.1.44 sport=443 dport=8456 src=192.168.1.44 dst=8.8.8.8 sport=8456 dport=443 [NEW]";
  it("returns an explicitly tentative candidate for a global source targeting the phone", () => {
    expect(parseExternalInboundConntrack(inbound, "192.168.1.44"))?.toContain("no prueba que una aplicación recibiera datos");
  });
  it("rejects private sources and non-NEW flows", () => {
    expect(parseExternalInboundConntrack(inbound.replace("8.8.8.8", "10.0.0.2"), "192.168.1.44")).toBeNull();
    expect(parseExternalInboundConntrack(inbound.replace("[NEW]", "[ASSURED]"), "192.168.1.44")).toBeNull();
  });
  it("rejects documentation ranges and out-of-range ports", () => {
    expect(parseExternalInboundConntrack(inbound.replace("8.8.8.8", "198.51.100.42"), "192.168.1.44")).toBeNull();
    expect(parseExternalInboundConntrack(inbound.replace("dport=8456", "dport=65536"), "192.168.1.44")).toBeNull();
  });
  it("recognizes a DNAT reply tuple only when the phone address matches", () => {
    const dnat = inbound.replace("dst=192.168.1.44", "dst=203.0.113.10").replace("src=192.168.1.44", "src=192.168.1.44");
    expect(parseExternalInboundConntrack(dnat, "192.168.1.44")).toContain("no prueba que una aplicación recibiera datos");
    expect(parseExternalInboundConntrack(dnat, "192.168.1.45")).toBeNull();
  });
});
