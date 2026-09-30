import { getEngineStatus, probeChatEngine } from "@/lib/llmSupervisor";
import { getTtsBackendKind, probeTtsEngine } from "@/lib/ttsSupervisor";
import { probeEmbedEngine } from "@/lib/embedSupervisor";
import { probeBackgroundEngine } from "@/lib/backgroundSupervisor";
import { listSidecars } from "@/lib/sidecars";

// This is the single live health snapshot used by both /api/health and
// status history. Keep its payload aligned with frontend chatAvailability
// and backend statusHistory.componentStatesFrom, which mirror that rule.
export async function collectHealth() {
  const [chat, embed, background, voice] = await Promise.all([probeChatEngine(), probeEmbedEngine(), probeBackgroundEngine(), probeTtsEngine()]);
  const sidecars = listSidecars();
  const ok =
    [chat, embed, background, voice].every((e) => e.alive !== false && e.kind !== "failed" && e.kind !== "restarting" && e.kind !== "blocked" && e.kind !== "stalled") &&
    sidecars.every((s) => s.status !== "unhealthy" && s.status !== "crashed");
  return { sidecars, brain: getEngineStatus().kind, voice: getTtsBackendKind(), ok, engines: { chat, embed, background, voice }, uptimeSeconds: process.uptime() };
}

export type HealthSnapshot = Awaited<ReturnType<typeof collectHealth>>;
