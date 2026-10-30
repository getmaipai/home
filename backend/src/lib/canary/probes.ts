// CANARY-01: the real probes. The chat probes run the production pipeline (runTurnNextStream and the wire event
// generator the chat route uses) as the health actor in temporary mode, then discard the session: nothing is stored.
import sharp from "sharp";
import { cpus, loadavg } from "node:os";
import { fileRestartBudget } from "./restartBudget";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents, SPOKEN_CUE_DELAY_MS, THINKING_CUE_DELAY_MS } from "@/routes/turn";
import { discardTemporarySessions, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { storeTemporaryChatImage } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { embed } from "@/lib/llm";
import { synthesizeSpeech } from "@/lib/tts";
import { transcribeUtterance } from "@/lib/stt";
import { roleHealth } from "@/lib/roleHealth";
import { getStackClient } from "@/lib/stackEngine";
import { getInstallStatus } from "@/lib/installStatus";
import { chatPausedByAdmin } from "@/lib/chatPause";
import { knownServiceComponents, serviceState } from "@/lib/serviceHealth";
import { turnActiveWithin } from "@/lib/turnActivity";
import { getHouseholdSettingValue } from "@/lib/settings";
import { submitGeneration, getGenerationJob, cancelOrDelete } from "@/lib/pictures/stack";
import { HEALTH_ACTOR_ID, healthActor } from "./identity";
import { IDLE_WINDOW_MS } from "./schedule";
import { decodeWav } from "./wav";
import type { ChatImagePart } from "@/wire";
import type { CanaryDeps, ChatProbe, ChatProbeRequest } from "./types";

const PICTURE_ID = "file-canary01";

async function testPicture(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 20, b: 20 } } }).jpeg().toBuffer());
}

export async function chatProbe(request: ChatProbeRequest): Promise<ChatProbe> {
  const actor = healthActor();
  const started = performance.now();
  const probe: ChatProbe = { ok: false, text: "", toolCalls: [], toolErrors: [], cue: false, firstTokenMs: null, totalMs: 0, error: null };
  const abort = new AbortController();
  const timer = setTimeout(() => { probe.error = "timeout"; abort.abort(); }, request.timeoutMs);
  try {
    let conversationId: string | undefined;
    let turnId: string | undefined;
    let images: ChatImagePart[] | undefined;
    if (request.picture) {
      const conversation = resolveOrCreateConversation(actor, "chat", undefined, { temporary: true });
      if (!conversation.ok) { probe.error = "unavailable"; return probe; }
      conversationId = conversation.value.id;
      turnId = newConversationTurnId();
      storeTemporaryChatImage({ id: PICTURE_ID, turnId, conversationId, ownerPersonId: actor.id, name: "test.jpg", mediaType: "image/jpeg", width: 64, height: 64, bytes: await testPicture() });
      images = [{ id: PICTURE_ID, name: "test.jpg", width: 64, height: 64, media_type: "image/jpeg" }];
    }
    const result = await runTurnNextStream(actor, "chat", request.text, {
      temporary: true, spoken: request.spoken === true, signal: abort.signal,
      ...(conversationId ? { conversationId, turnId, images } : {}),
    });
    if (!result.ok) { probe.error = String(result.code ?? "unavailable"); return probe; }
    if (result.kind === "immediate") { // a reply that needed no stream (a command, a refusal)
      probe.text = result.value.reply.text;
      probe.ok = true;
      for (const e of result.toolEvents ?? []) { if (e.t === "tool_call") probe.toolCalls.push(e.package_id); else if (e.t === "tool_error") probe.toolErrors.push(e.package_id); }
      return probe;
    }
    const events = streamTurnEvents(result, actor.id, request.spoken ? SPOKEN_CUE_DELAY_MS : THINKING_CUE_DELAY_MS, abort.signal, false, undefined, "adult", undefined, undefined, { spokenTurn: request.spoken === true });
    for await (const event of events) {
      if (event.type === "delta" && event.text) {
        probe.text += event.text;
        probe.firstTokenMs ??= Math.round(performance.now() - started);
      } else if (event.type === "spoken_cue") probe.cue = true;
      else if (event.type === "error") { probe.error ??= event.code ?? "error"; }
      else if (event.type === "done") {
        // A package's own reply (a weather card, a command) arrives whole in the done value with no delta before it.
        if (!probe.text.trim() && event.value.reply.text.trim()) {
          probe.text = event.value.reply.text;
          probe.firstTokenMs ??= Math.round(performance.now() - started);
        }
        probe.ok = probe.error === null;
      }
    }
    for (const e of result.toolEvents ?? []) {
      if (e.t === "tool_call") probe.toolCalls.push(e.package_id);
      else if (e.t === "tool_error") probe.toolErrors.push(e.package_id);
    }
  } catch {
    probe.error ??= "unavailable";
  } finally {
    clearTimeout(timer);
    probe.totalMs = Math.round(performance.now() - started);
    discardTemporarySessions(HEALTH_ACTOR_ID);
  }
  return probe;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function loopbackProbe(phrase: string): Promise<{ ok: boolean; heard: string; stage?: "tts" | "stt"; error?: string }> {
  const spoken = await synthesizeSpeech(phrase);
  if (!spoken.ok) return { ok: false, heard: "", stage: "tts", error: spoken.code };
  const audio = decodeWav(await readAll(spoken.value.stream));
  if (!audio) return { ok: false, heard: "", stage: "tts", error: "unreadable_audio" };
  try {
    return { ok: true, heard: await transcribeUtterance(audio.samples, audio.sampleRate) };
  } catch {
    return { ok: false, heard: "", stage: "stt", error: "stt_failed" };
  }
}

export async function imageProbe(): Promise<{ ok: boolean; error?: string }> {
  try {
    const submitted = await submitGeneration({ prompt: "a plain red circle on a white background", size: "256x256", n: 1, steps: 1, audience: "all-ages", timeout_ms: 1 });
    const deadline = Date.now() + 200_000;
    let ok = submitted.done !== null;
    while (!ok && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const job = await getGenerationJob(submitted.job);
      if (job.state === "failed" || job.state === "cancelled") break;
      if (job.state === "done") ok = job.data.length > 0;
      if (job.state === "done") break;
    }
    await cancelOrDelete(submitted.job).catch(() => undefined);
    return { ok };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "failed" };
  }
}

export async function stackBlocker(): Promise<string | null> {
  if (chatPausedByAdmin()) return "Chat is paused by an admin.";
  try {
    const heal = await getStackClient().selfHeal?.();
    if (heal?.blocker) return heal.blocker;
  } catch { /* an older Stack has no self-heal route: the other gates still apply */ }
  const install = await getInstallStatus().catch(() => null);
  if (install && (install.state === "downloading" || install.state === "installing_engine" || install.background)) return "An install is running.";
  const chat = await roleHealth("chat", { live: true }).catch(() => null);
  if (chat?.cause === "memory") return "This computer is low on memory.";
  return null;
}

/** One supervised restart of the chat engine through the Stack's self-heal path. An older Stack has no such route: then nothing restarts. */
export async function stackRestart(reason: string, role: "chat" | "image" | "video" = "chat"): Promise<boolean> {
  try {
    const answer = await getStackClient().requestSelfHealRestart?.(role, reason.slice(0, 200));
    return answer?.accepted === true;
  } catch {
    return false;
  }
}

export async function stackGpuCompile(): Promise<{ ok: boolean; reason: string | null } | null> {
  try { return (await getStackClient().gpuHealth?.()) ?? null; } catch { return null; }
}

export function loadIsHigh(): boolean {
  return loadavg()[0]! > 2 * cpus().length;
}

export function searchTroubleNow(): boolean {
  return knownServiceComponents().some((c) => /search|duck|ddg|searx|brave|bing/i.test(c) && serviceState(c) !== "operational" && serviceState(c) !== "unknown");
}

export const realDeps: CanaryDeps = {
  chat: chatProbe,
  async embed() {
    const result = await embed(["health check"]);
    return result.ok ? { ok: true, dims: result.value.vectors[0]?.length ?? 0 } : { ok: false, dims: 0, error: result.code };
  },
  loopback: loopbackProbe,
  image: imageProbe,
  async chatRole() {
    const r = await roleHealth("chat", { live: true });
    return { availability: r.availability, reason: r.reason, ...(r.cause ? { cause: r.cause } : {}) };
  },
  async visionReady() {
    try {
      const { roles } = await getStackClient().roles();
      return roles.find((r) => r.id === "chat")?.model?.imageInput === true;
    } catch { return false; }
  },
  blocker: stackBlocker,
  turnActive: () => turnActiveWithin(IDLE_WINDOW_MS),
  requestRestart: stackRestart,
  gpuCompile: stackGpuCompile,
  loadHigh: loadIsHigh,
  searchConfigured: () => Boolean(getHouseholdSettingValue("search.searxng_url")),
  restartBudget: fileRestartBudget(),
  searchTrouble: searchTroubleNow,
  keepWarm: () => getHouseholdSettingValue("health.keep_warm") !== false,
  now: () => Date.now(),
  random: () => Math.random(),
};
