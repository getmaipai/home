// VOICE-LIVE-01b: `GET /api/engines`'s overview route used to answer
// `roles: []` unconditionally whenever no Stack was configured
// (routes/engines.ts's own early return) - the common household case,
// since this hub runs its own supervisors instead. Every frontend gate
// reading `roles` (`readyRole()`, engineRoles.ts) could therefore never
// see stt/tts/chat/embed as ready on a non-Stack hub, no matter how
// healthy they really were - found live (Jesse: no waveform button on
// 8787, this hub has no Stack). This file is the missing half: the
// SAME RoleInfo shape the Stack already returns, built from Home's own
// supervisors instead, so a caller never needs to know which source
// answered (SERVICES.md's "one health list" principle - one shape, two
// sources, never a second concept for "is this hub's own tts ready").
import { probeChatEngine, getEngineStatus } from "@/lib/llmSupervisor";
import { probeTtsEngine } from "@/lib/ttsSupervisor";
import { probeEmbedEngine } from "@/lib/embedSupervisor";
import { sttAssetsInstalled } from "@/lib/stt";
import type { EngineHealth } from "@/lib/sidecars";
import type { RoleInfo, RoleState } from "@/lib/stack/types";

/** `probeXEngine()` (llmSupervisor.ts/ttsSupervisor.ts/embedSupervisor.ts)
 * is the exact function `GET /api/health` already builds its own
 * admin-facing read from (app.ts's healthRoute) - reused here rather
 * than re-derived, so this route can never show "ready" for an engine
 * Health shows red for at the same moment (a review finding: an
 * earlier version of this file reported chat/tts/embed ready
 * unconditionally, on the true but incomplete reasoning that each
 * supervisor's own last tier is a stub that never fails to START - it
 * missed that a manually-stopped engine, or one crash-looping after a
 * real spawn attempt, is a genuinely different, already-tracked state
 * (`kind: "stopped"/"failed"/"restarting"`, sidecars.ts's own
 * `engineHealthKind()`) that Health already surfaces and this route
 * now has to agree with). A second re-review caught the same gap for
 * `kind: "starting"` (a JIT spawn actually in flight, `alive` still
 * null because no client exists yet to probe) - it was falling into
 * the same bucket as "never tried this boot," reporting `ready` at the
 * exact moment Health's own badge reads "starting up." `loaded` is the
 * one `RoleState` already has for "in progress, not confirmed
 * answering yet" (NextEnginesPage.tsx's own `ROLE_STATE_LABEL`: "in
 * progress" is not ambiguous with either `installed`, which this route
 * never has an unambiguous signal for since it does not track download
 * state, or `ready`). `alive === null` outside of `"starting"` (no
 * client yet, and no spawn in flight either - the common "hasn't been
 * asked anything yet this boot" case) is not itself a failure: the
 * supervisor's own guaranteed stub tier means it would answer if
 * asked, so only a REAL negative or in-progress signal (a
 * failed/restarting/stopped/starting kind, or a probe that came back
 * false) reads as anything other than `ready` here. */
export function stateFromProbe(health: EngineHealth): RoleState {
  const now = new Date().toISOString();
  if (health.kind === "failed") return { state: "offline", since: now, checkedAt: now, reason: "This engine keeps failing to start." };
  if (health.kind === "restarting") return { state: "offline", since: now, checkedAt: now, reason: "Restarting after a crash." };
  if (health.kind === "stopped") return { state: "offline", since: now, checkedAt: now, reason: "Manually stopped." };
  if (health.kind === "starting") return { state: "loaded", since: now, checkedAt: now, reason: "Starting up." };
  if (health.alive === false) return { state: "offline", since: now, checkedAt: now, reason: "Not answering right now." };
  return { state: "ready", since: now, checkedAt: now };
}

function notInstalledRoleState(reason: string): RoleState {
  const now = new Date().toISOString();
  return { state: "notInstalled", since: now, checkedAt: now, reason };
}

const NO_CHECK = { state: "skipped" as const, at: null, reason: null, stale: false };

async function chatRole(): Promise<RoleInfo> {
  const health = await probeChatEngine();
  const status = getEngineStatus();
  return {
    id: "chat",
    label: "Chat",
    wire: "chat",
    residency: "jit",
    endpoints: [`http://localhost:${process.env.MAIPAI_LLAMA_SERVER_PORT ?? 8788}`],
    quality: ["everyday"],
    sharesModelWith: null,
    state: stateFromProbe(health),
    reason: null,
    model: status.modelId ? { id: status.modelId, sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true } : null,
    check: NO_CHECK,
  };
}

async function ttsRole(): Promise<RoleInfo> {
  const health = await probeTtsEngine();
  return {
    id: "tts",
    label: "Text to speech",
    wire: "speech",
    residency: "jit",
    endpoints: [`http://localhost:${process.env.MAIPAI_TTS_PORT ?? 8793}`],
    quality: ["everyday"],
    sharesModelWith: null,
    state: stateFromProbe(health),
    reason: null,
    model: null,
    check: NO_CHECK,
  };
}

async function embedRole(): Promise<RoleInfo> {
  const health = await probeEmbedEngine();
  return {
    id: "embed",
    label: "Embeddings",
    wire: "embeddings",
    residency: "jit",
    endpoints: [`http://localhost:${process.env.MAIPAI_EMBED_PORT ?? 8794}`],
    quality: ["everyday"],
    sharesModelWith: null,
    state: stateFromProbe(health),
    reason: null,
    model: null,
    check: NO_CHECK,
  };
}

/** stt has no stub fallback and no separate process to supervise
 * (lib/stt.ts's own header: sherpa-onnx-node is an in-process native
 * addon, so there is no `probeSttEngine()` the way chat/tts/embed each
 * have) - it is real assets on disk or it is nothing, checked directly
 * rather than through a probe. */
function sttRole(): RoleInfo {
  const installed = sttAssetsInstalled();
  return {
    id: "stt",
    label: "Speech to text",
    wire: "transcription",
    residency: "jit",
    endpoints: [],
    quality: ["everyday"],
    sharesModelWith: null,
    state: installed
      ? { state: "ready", since: new Date().toISOString(), checkedAt: new Date().toISOString() }
      : notInstalledRoleState("STT assets (Silero VAD, Moonshine) have not finished downloading yet."),
    reason: null,
    model: null,
    check: NO_CHECK,
  };
}

/** Nothing exists on the Home side for image generation yet (both
 * catalog entries in modelCatalog.ts are `implemented: false`, no
 * supervisor, no probe) - reported honestly as not installed rather
 * than omitted, so a caller iterating every role id gets a real answer
 * for all of them, the same "null, not silently missing" posture
 * dashboard.ts's own engineStatusCounts() already takes. */
function imageRole(): RoleInfo {
  return {
    id: "image",
    label: "Image generation",
    wire: "job",
    residency: "installed",
    endpoints: [],
    quality: [],
    sharesModelWith: null,
    state: notInstalledRoleState("No image-generation engine is implemented on this hub yet."),
    reason: "Not implemented on this hub yet.",
    model: null,
    check: NO_CHECK,
  };
}

/** `GET /api/engines`'s own roles source when no Stack is configured -
 * chat/tts/embed each do the identical live probe `GET /api/health`
 * already makes (no new network behavior, and the two routes can no
 * longer disagree about the same engine's own state); stt and image
 * are synchronous, side-effect-free reads (no probe to make - see each
 * one's own comment for why). Nothing here ever spawns anything, the
 * same posture the route's Stack-configured path already has. */
export async function getHomeSupervisorRoles(): Promise<RoleInfo[]> {
  const [chat, tts, embed] = await Promise.all([chatRole(), ttsRole(), embedRole()]);
  return [chat, tts, sttRole(), embed, imageRole()];
}
