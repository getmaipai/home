import { appendLogLine } from "@/lib/log";
import type { FillerGroup } from "@/lib/quickReaction";

const SOURCES = ["model", "rule"] as const;
type FillerSource = (typeof SOURCES)[number];

/** Closed voice event registry: only non-identifying chooser measurements are accepted. */
export function reportFillerEvent(event: { group: FillerGroup | null; source: FillerSource | null; ms: number }): void {
  appendLogLine(JSON.stringify({ event: "voice.filler", group: event.group, source: event.source, ms: Math.max(0, Math.round(event.ms)) }));
}
