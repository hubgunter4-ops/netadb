export type EventTone = "green" | "yellow" | "red" | "cyan" | "blue" | "magenta" | "neutral";
export type ClassifiedEvent = { label: string; detail: string; tone: EventTone };

export const SNAPSHOT_COMMANDS = [
  ["connectivity", "dumpsys connectivity"],
  ["netstats", "dumpsys netstats"],
  ["dnsresolver", "dumpsys dnsresolver"],
  ["wifi", "dumpsys wifi"],
] as const;

export function classifyLogcatLine(line: string): ClassifiedEvent | null {
  const lower = line.toLowerCase();
  const actionMarkers = ["fcm", "firebase.messaging", "gcmreceiver", "pendingintent", "broadcastqueue", "broadcastreceiver", "onreceive(", "jobservicecontext", "workscheduler", "workmanager", "startactivity", "startservice", "sendbroadcast", "sendorderedbroadcast", "intent { act="];
  if (actionMarkers.some((marker) => lower.includes(marker))) return { label: "ACCIÓN / INTENT", detail: "Evento de recepción o dispatch observado; el log local no confirma origen externo.", tone: "magenta" };
  if (lower.includes("com.google.android.gms") && lower.includes("misatellitenetworkfactory")) return { label: "GMS / SATÉLITE", detail: "Solicitud de transporte registrada; no confirma conexión.", tone: "magenta" };
  if (lower.includes("wifi network lost") || lower.includes("handleeventwificonnectivitystatechanged: false")) return { label: "WIFI / PÉRDIDA", detail: "Android registró pérdida del enlace Wi‑Fi.", tone: "yellow" };
  if (lower.includes("wifi is connected") || lower.includes("updatewifistateinfo: connected=true")) return { label: "WIFI / CONECTADO", detail: "Android registró conexión o reconexión Wi‑Fi.", tone: "green" };
  if (lower.includes("transports: wifi") && lower.includes("validated")) return { label: "WIFI / VALIDADO", detail: "La red Wi‑Fi figura validada por Android.", tone: "green" };
  if (lower.includes("private dns") || lower.includes("dnsresolver") || lower.includes("dns resolver")) return { label: "DNS", detail: "Evento del resolvedor DNS.", tone: "cyan" };
  if (lower.includes("transports: cellular") || lower.includes("setupdatacall") || lower.includes("data connection")) return { label: "MÓVIL", detail: "Evento de conectividad móvil.", tone: "blue" };
  if (lower.includes("network lost") || lower.includes("onlost()")) return { label: "RED / PÉRDIDA", detail: "Android registró pérdida de una red.", tone: "yellow" };
  if (lower.includes("onavailable()") || lower.includes("network available")) return { label: "RED / DISPONIBLE", detail: "Android registró disponibilidad de una red.", tone: "green" };
  return null;
}

function parseIp(input: string): string | null {
  const value = input.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (value.includes(":")) {
    if (!/^[0-9a-f:.]+$/i.test(value)) return null;
    return value.toLowerCase();
  }
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number).join(".");
}

function isGlobalIp(value: string): boolean {
  const ip = parseIp(value);
  if (!ip) return false;
  if (ip.includes(":")) {
    if (ip.startsWith("::ffff:")) return isGlobalIp(ip.slice(7));
    const normalized = ip.replace(/^0+:0+:0+:0+:0+:0+:0+:1$/, "::1");
    if (["::", "::1"].includes(normalized) || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8")) return false;
    return /^[23]/.test(normalized);
  }
  const octets = ip.split(".").map(Number);
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function parseExternalInboundConntrack(line: string, phoneIp: string): string | null {
  if (!/(?:^|\s)\[?NEW\]?(?:\s|$)/i.test(line)) return null;
  const fields: Record<string, string[]> = {};
  for (const key of ["src", "dst", "sport", "dport"]) fields[key] = [...line.matchAll(new RegExp(`\\b${key}=([^\\s]+)`, "g"))].map((match) => match[1]);
  if (Object.values(fields).some((values) => values.length < 2)) return null;
  const phone = parseIp(phoneIp);
  const originalSrc = parseIp(fields.src[0]);
  const originalDst = parseIp(fields.dst[0]);
  const replySrc = parseIp(fields.src[1]);
  if (!phone || !originalSrc || !originalDst || !replySrc || !isGlobalIp(originalSrc)) return null;
  let localPort: string;
  if (originalDst === phone) localPort = fields.dport[0];
  else if (replySrc === phone) localPort = fields.sport[1];
  else return null;
  const validPort = (port: string) => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
  if (![...fields.sport, ...fields.dport].every(validPort) || !validPort(localPort)) return null;
  return `Posible entrante externa NEW: ${originalSrc}:${fields.sport[0]} → ${phone}:${localPort}. Verifica ACCEPT en el firewall; conntrack por sí solo no prueba que una aplicación recibiera datos.\n${line}`;
}

export function utcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
