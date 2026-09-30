import type { EngineHealthEntry } from "@/lib/api";

export type ChatAvailability = "ready" | "starting" | "unavailable";

export function chatAvailability(engine: EngineHealthEntry | undefined): ChatAvailability {
  if (!engine) return "ready";
  return engine.availability ?? "ready";
}
