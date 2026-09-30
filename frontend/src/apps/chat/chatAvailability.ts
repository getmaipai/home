import type { EngineHealthEntry } from "@/lib/api";

export type ChatAvailability = "ready" | "starting" | "unavailable";

export function chatAvailability(engine: EngineHealthEntry | undefined): ChatAvailability {
  if (!engine) return "ready";
  if (engine.availability) return engine.availability;

  const { kind, alive } = engine;
  if (kind === "blocked" || kind === "failed" || kind === "stalled" || kind === "stopped") return "unavailable";
  if (kind === "starting" || kind === "restarting") return "starting";
  if ((kind === "url" || kind === "override" || kind === "selection" || kind === "spawned") && alive === false) return "unavailable";
  return "ready";
}
