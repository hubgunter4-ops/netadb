export type ComparableSnapshot = {
  capturedAt: string;
  files: Record<string, string>;
  errors: string[];
};

export type SnapshotLineChange = { line: string; count: number };
export type SnapshotSourceDiff = {
  source: string;
  addedCount: number;
  removedCount: number;
  added: SnapshotLineChange[];
  removed: SnapshotLineChange[];
  categories: Record<string, number>;
  missingFromBase: boolean;
  missingFromCurrent: boolean;
  truncated: boolean;
};
export type SnapshotComparison = {
  baseAt: string;
  currentAt: string;
  sources: SnapshotSourceDiff[];
  addedCount: number;
  removedCount: number;
  changedSources: number;
  baseErrors: string[];
  currentErrors: string[];
};

const MAX_LINES_PER_SOURCE = 30_000;
const MAX_PREVIEW_LINES = 24;
const categories = [
  { name: "DNS", pattern: /dnsresolver|\bdns\b|nameserver|name server/i },
  { name: "Wi-Fi", pattern: /wifi|wi-fi|wlan|ssid|bssid|supplicant|softap/i },
  { name: "Móvil", pattern: /telephony|cellular|mobile data|data registration|signalstrength|\blte\b|\bnr\b/i },
  { name: "IP y rutas", pattern: /linkproperties|ip address|ip addr|route|gateway|ipv[46]|interface|\bwlan\d*\b/i },
  { name: "Conectividad", pattern: /networkagent|connectivityservice|networkcapabilit|\bconnected\b|\bdisconnected\b|\bvalidated\b|\binternet\b|network.*(available|lost|connected)/i },
  { name: "Dispositivo / paquetes", pattern: /package|activitymanager|process|build fingerprint|deviceidle/i },
] as const;

function normalizedLines(contents: string | undefined): { counts: Map<string, number>; truncated: boolean } {
  const allLines = (contents ?? "").split(/\r?\n/).filter((line) => line.trim() && !/^# Captured UTC:/i.test(line));
  const truncated = allLines.length > MAX_LINES_PER_SOURCE;
  const counts = new Map<string, number>();
  for (const raw of allLines.slice(0, MAX_LINES_PER_SOURCE)) {
    const line = raw.trim();
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return { counts, truncated };
}

function classifyLine(line: string): string {
  return categories.find((category) => category.pattern.test(line))?.name ?? "Otros";
}

function difference(from: Map<string, number>, to: Map<string, number>): SnapshotLineChange[] {
  const changes: SnapshotLineChange[] = [];
  for (const [line, count] of to) {
    const delta = count - (from.get(line) ?? 0);
    if (delta > 0) changes.push({ line, count: delta });
  }
  return changes.sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));
}

export function compareSnapshots(base: ComparableSnapshot, current: ComparableSnapshot): SnapshotComparison {
  const names = [...new Set([...Object.keys(base.files), ...Object.keys(current.files)])].sort();
  const sources: SnapshotSourceDiff[] = names.map((source) => {
    const hasBase = Object.hasOwn(base.files, source);
    const hasCurrent = Object.hasOwn(current.files, source);
    const left = normalizedLines(base.files[source]);
    const right = normalizedLines(current.files[source]);
    const added = difference(left.counts, right.counts);
    const removed = difference(right.counts, left.counts);
    const categoryCounts: Record<string, number> = {};
    for (const item of [...added, ...removed]) {
      const category = classifyLine(item.line);
      categoryCounts[category] = (categoryCounts[category] ?? 0) + item.count;
    }
    return {
      source,
      addedCount: added.reduce((sum, item) => sum + item.count, 0),
      removedCount: removed.reduce((sum, item) => sum + item.count, 0),
      added: added.slice(0, MAX_PREVIEW_LINES),
      removed: removed.slice(0, MAX_PREVIEW_LINES),
      categories: categoryCounts,
      missingFromBase: !hasBase,
      missingFromCurrent: !hasCurrent,
      truncated: left.truncated || right.truncated,
    };
  });
  const changedSources = sources.filter((source) => source.addedCount > 0 || source.removedCount > 0 || source.missingFromBase || source.missingFromCurrent).length;
  return {
    baseAt: base.capturedAt,
    currentAt: current.capturedAt,
    sources,
    addedCount: sources.reduce((sum, source) => sum + source.addedCount, 0),
    removedCount: sources.reduce((sum, source) => sum + source.removedCount, 0),
    changedSources,
    baseErrors: [...base.errors],
    currentErrors: [...current.errors],
  };
}
