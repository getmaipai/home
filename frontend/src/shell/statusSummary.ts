import { i18n } from "@lingui/core";
import type { HealthStatus } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import { engineRows } from "@/shell/pages/status/StatusComponents";

export interface StatusSummary {
  level: "online" | "degraded" | "offline" | "maintenance";
  text: string;
  problems: string[];
}

const sidecarLabel = (id: string): string | undefined => ({
  "kiwix-serve": engineRows().find((row) => row.key === "library")!.label,
  searxng: i18n._({ id: "Search", message: "Search" }),
} as Record<string, string>)[id];

export function statusSummary(health: HealthStatus | undefined, underMaintenance: string[] = []): StatusSummary {
  if (!health) return underMaintenance.length ? { level: "maintenance", text: i18n._({ id: "Maintenance", message: "Maintenance" }), problems: [] } : { level: "online", text: i18n._({ id: "All good", message: "All good" }), problems: [] };

  let level: StatusSummary["level"] = "online";
  const problems: string[] = [];

  for (const row of engineRows()) {
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
      problems.push(sidecarLabel(sidecar.id) ?? sidecar.id);
    }
  }

  if (level === "online" && underMaintenance.length > 0) level = "maintenance";
  const text = level === "online" ? i18n._({ id: "All good", message: "All good" }) : level === "degraded" ? i18n._({ id: "Degraded", message: "Degraded" }) : level === "maintenance" ? i18n._({ id: "Maintenance", message: "Maintenance" }) : i18n._({ id: "Something is down", message: "Something is down" });
  return { level, text, problems };
}
