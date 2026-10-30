// CANARY-01: the checks. Each asserts BEHAVIOUR (a tool was called, text arrived, a vector came back), never wording.
import { getHouseholdSettingValue } from "@/lib/settings";
import type { CanaryCheck, CanaryId, ChatProbe, Outcome } from "./types";

/** Short fixed set of generic phrases; none carries household data. The scheduler picks one per run. */
export const SEARCH_PHRASES = [
  "is cloudflare down right now",
  "is github down right now",
  "are there any cloudflare outages today",
  "is the cloudflare status page showing problems right now",
] as const;

export const LOOPBACK_PHRASE = "The kitchen light is on and the door is open";
export const WEATHER_PHRASE = "What's the weather in Hartford right now?";
const PICTURE_PHRASE = "What colour is this picture? Answer in one word.";

const pass = (probe?: ChatProbe): Outcome => ({ kind: "pass", firstTokenMs: probe?.firstTokenMs ?? null });
const fail = (cause: string, fix: string, life?: "dead" | "hung"): Outcome => ({ kind: "fail", cause, fix, ...(life ? { life } : {}) });
export const GPU_CAUSE = "Pictures, video and chat are paused because this Mac's graphics compiler is not responding.";
export const GPU_FIX = "Restart the Mac when nobody is using it.";
const CHECK_AGAIN = "Open Status, then choose Run checks now. If it fails again, restart the AI from Settings, AI.";

function transport(probe: ChatProbe, what: string): Outcome | null {
  if (probe.error === "timeout") return fail(`${what} did not answer within the time allowed.`, `${CHECK_AGAIN} A busy or low-memory computer is the usual reason.`, probe.firstTokenMs === null ? "hung" : undefined);
  if (!probe.ok) return fail(`${what} was refused or stopped before it answered.`, CHECK_AGAIN);
  return null;
}

/** Match words in order-free fashion: at least 60 percent of the expected words were heard. */
export function wordMatch(expected: string, heard: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const want = words(expected);
  const got = new Set(words(heard));
  return want.length > 0 && want.filter((w) => got.has(w)).length / want.length >= 0.6;
}

export const CHECKS: CanaryCheck[] = [
  {
    id: "chat_hello", name: "Chat answers", group: "chat", timeoutMs: 125_000, title: "Chat is not answering",
    async run(deps) {
      const role = await deps.chatRole();
      if (role.availability === "unavailable") return fail("The chat engine is not running.", "Open Repairs for the engine problem, or restart the AI from Settings, AI.", "dead");
      const probe = await deps.chat({ text: "hi", timeoutMs: 120_000 });
      const bad = transport(probe, "Chat");
      if (bad) return bad;
      if (!probe.text.trim()) return fail("Chat is running but answered with nothing.", CHECK_AGAIN);
      return pass(probe);
    },
  },
  {
    id: "embed", name: "Memory search", group: "chat", timeoutMs: 20_000, title: "Memory search is not working",
    async run(deps) {
      const result = await deps.embed();
      return result.ok && result.dims > 0 ? pass() : fail("The embedding engine did not return a result, so memory and search ranking cannot work.", CHECK_AGAIN);
    },
  },
  {
    id: "gpu_metal", name: "Graphics compiler", group: "pictures", timeoutMs: 15_000, title: "Pictures, video and chat are paused",
    async run(deps) {
      const answer = await deps.gpuCompile();
      if (!answer) return { kind: "skip", reason: "The Stack could not be asked about the graphics compiler." };
      return answer.ok ? pass() : fail(GPU_CAUSE, GPU_FIX);
    },
  },
  {
    id: "chat_tool_weather", name: "Chat uses tools (weather)", group: "tools", timeoutMs: 75_000, title: "Chat did not use the weather tool",
    async run(deps, ctx) {
      if (ctx.chatDown) return { kind: "skip", reason: "Chat is not running." };
      const probe = await deps.chat({ text: WEATHER_PHRASE, timeoutMs: 75_000 });
      const bad = transport(probe, "Chat");
      if (bad) return bad;
      if (!probe.toolCalls.includes("weather")) return fail("Chat is up but did not look up the weather when asked: it answered without using the weather tool.", CHECK_AGAIN);
      if (probe.toolErrors.includes("weather")) return fail("Chat asked the weather tool, but the weather lookup failed.", "Check that this computer is online, then run the checks again.");
      if (!probe.text.trim()) return fail("Chat looked up the weather but did not say anything afterwards.", CHECK_AGAIN);
      return pass(probe);
    },
  },
  {
    id: "spoken_turn", name: "Spoken replies", group: "voice", timeoutMs: 75_000, title: "Spoken replies come back empty",
    async run(deps, ctx) {
      if (ctx.chatDown) return { kind: "skip", reason: "Chat is not running." };
      const probe = await deps.chat({ text: "hello there", spoken: true, timeoutMs: 75_000 });
      const bad = transport(probe, "A spoken turn");
      if (bad) return bad;
      if (!probe.text.trim()) return fail(probe.cue ? "A spoken turn only played a waiting phrase and never gave an answer." : "A spoken turn gave no answer.", CHECK_AGAIN);
      return pass(probe);
    },
  },
  {
    id: "stt_tts_loopback", name: "Voice in and out", group: "voice", timeoutMs: 120_000, title: "Voice is not working",
    async run(deps) {
      const result = await deps.loopback(LOOPBACK_PHRASE);
      if (!result.ok) return fail(result.stage === "stt" ? "The speech engine could not turn the test audio back into words." : "The voice engine could not say the test phrase.", "Check the voice engine in Settings, Voice, then run the checks again.");
      if (!wordMatch(LOOPBACK_PHRASE, result.heard)) return fail("Voice in and out disagree: the voice engine said a test phrase and the speech engine heard something different.", "Check the voice and speech engines in Settings, Voice, then run the checks again.");
      return pass();
    },
  },
  {
    id: "chat_picture_read", name: "Chat reads pictures", group: "pictures", timeoutMs: 120_000, title: "Chat cannot read pictures",
    async run(deps, ctx) {
      if (ctx.chatDown) return { kind: "skip", reason: "Chat is not running." };
      if (!(await deps.visionReady())) return { kind: "skip", reason: "The chat model does not read pictures." };
      const probe = await deps.chat({ text: PICTURE_PHRASE, picture: true, timeoutMs: 120_000 });
      const bad = transport(probe, "Chat");
      if (bad) return bad;
      if (!/\bred\b|\bcrimson\b|\bscarlet\b/i.test(probe.text)) return fail("Chat was shown a plain red picture and did not describe it, so picture reading is not working.", CHECK_AGAIN);
      return pass(probe);
    },
  },
  {
    id: "chat_search_trigger", name: "Chat searches the web", group: "search", timeoutMs: 120_000, title: "Chat did not search the web when asked",
    async run(deps, ctx) {
      if (ctx.chatDown) return { kind: "skip", reason: "Chat is not running." };
      if (!deps.searchConfigured()) return { kind: "skip", reason: "Web search is not set up. Add its address in Settings, Web search." };
      const probe = await deps.chat({ text: ctx.searchPhrase, timeoutMs: 120_000 });
      const bad = transport(probe, "Chat");
      if (bad) return bad;
      if (!probe.toolCalls.includes("websearch")) return fail("Chat is up but did not search the web when asked: it answered from memory.", "Check Settings, Web search, then run the checks again.");
      if (probe.toolErrors.includes("websearch")) return fail("Chat tried to search the web, but the search failed.", "Check Settings, Web search and run its Test, then run the checks again.");
      if (!probe.text.trim()) return fail("Chat searched the web but did not answer afterwards.", CHECK_AGAIN);
      return pass(probe);
    },
  },
  {
    id: "image_tiny", name: "Pictures", group: "pictures", timeoutMs: 240_000, title: "Picture making is not working",
    async run(deps) {
      // In coding mode picture jobs wait on purpose, so a missing test picture is not a fault.
      if (getHouseholdSettingValue("coding.home_mode") === "coding") return { kind: "skip", reason: "Home is busy with a big job, so pictures wait." };
      const result = await deps.image();
      return result.ok ? pass() : fail("The picture engine did not make a small test picture.", "Open Settings, Pictures and videos, check the picture model, then run the checks again.");
    },
  },
];

export const CHECK_BY_ID = new Map<CanaryId, CanaryCheck>(CHECKS.map((c) => [c.id, c]));
