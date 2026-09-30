import type { HealthStatus } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";
import { ENGINE_ROWS } from "@/apps/settings/HealthSection";

export interface StatusSummary {
  level: "online" | "degraded" | "offline";
  text: string;
  problems: string[];
}

const SIDECAR_LABELS: Record<string, string> = {
  "kiwix-serve": "Library",
  searxng: "Search",
};

export function statusSummary(health: HealthStatus | undefined): StatusSummary {
  if (!health) return { level: "online", text: "All good", problems: [] };

  let level: StatusSummary["level"] = "online";
  const problems: string[] = [];

  for (const row of ENGINE_ROWS) {
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
    if (sidecar.status === "unhealthy" || sidecar.status === "crashed") {
      if (level === "online") level = "degraded";
      problems.push(SIDECAR_LABELS[sidecar.id] ?? sidecar.id);
    }
  }

  const text = level === "online" ? "All good" : level === "degraded" ? "Degraded" : "Something is down";
  return { level, text, problems };
}
