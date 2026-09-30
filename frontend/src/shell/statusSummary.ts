import type { HealthStatus } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import { ENGINE_ROWS } from "@/next/pages/status/StatusComponents";

export interface StatusSummary {
  level: "online" | "degraded" | "offline" | "maintenance";
  text: string;
  problems: string[];
}

const SIDECAR_LABELS: Record<string, string> = {
  "kiwix-serve": ENGINE_ROWS.find((row) => row.key === "library")!.label,
  searxng: "Search",
};

export function statusSummary(health: HealthStatus | undefined, underMaintenance: string[] = []): StatusSummary {
  if (!health) return underMaintenance.length ? { level: "maintenance", text: "Maintenance", problems: [] } : { level: "online", text: "All good", problems: [] };

  let level: StatusSummary["level"] = "online";
  const problems: string[] = [];

  for (const row of ENGINE_ROWS) {
    if (row.key === "library" || row.key === "hub") continue;
    if (underMaintenance.includes(row.key)) continue;
    const availability = chatAvailability(health.engines[row.key]);
    if (availability === "unavailable") {
      level = "offline";
      problems.push(row.label);
    } else if (availability === "starting") {
      if (level === "online") level = "degraded";
      problems.push(row.label);
    }
  }

  for (const sidecar of health.sidecars) {
    if (sidecar.id === "kiwix-serve" && underMaintenance.includes("library")) continue;
    if (sidecar.status === "unhealthy" || sidecar.status === "crashed") {
      if (level === "online") level = "degraded";
      problems.push(SIDECAR_LABELS[sidecar.id] ?? sidecar.id);
    }
  }

  if (level === "online" && underMaintenance.length > 0) level = "maintenance";
  const text = level === "online" ? "All good" : level === "degraded" ? "Degraded" : level === "maintenance" ? "Maintenance" : "Something is down";
  return { level, text, problems };
}
