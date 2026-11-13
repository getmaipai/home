// DICT-01 (2026-09-23): this file used to hand-declare its own guessed
// shape for `WS /api/stt/stream`'s server messages ({type, text}),
// written before the real route existed - "the frozen C-to-E contract"
// its own header called it. Once the route landed, the real spec
// (`@maipai/spec/voice/ts/sttTypes.ts`'s `SttWireEvent`, the type
// `backend/src/lib/sttSession.ts` actually sends) turned out to use
// short keys instead ({t, v}), and nobody reconciled the two: dictation
// silently did nothing in every browser, forever, because
// `sttDictationAdapter.ts`'s `switch (message.type)` never matched a
// single real server message (a live Jesse report, "I don't think
// dictation works in the browser yet," diagnosed by a headless Chromium
// repro with a fake mic device - zero audio frames ever left the
// client, because the "ready" message's `t` field was read as `type`
// and never matched, so `startMicCapture()` was never even called).
// Re-exported from the real spec now, not hand-copied a second time -
// the same "one definition" reason every other spec-backed type in this
// codebase already imports rather than mirrors. `SttHelloMessage` is
// gone with it: the spec names no client-to-server "hello" message at
// all (only the audio frames themselves and an optional `{"t":"end"}`),
// so the one `sttSocket.ts` used to send was never part of any real
// contract and the server has never read it.
// STT-SMARTTURN-01: the hub marks the partial it transcribed at the first silent frame with `edge: true` (additive; absent on
// cadence partials and from older hubs), so the client can begin a speculative turn on it before the final lands.
// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 4): three more additive fields. `ready.talk_over` names the "Talk before I
// finish" level the hub granted this session (absent for a minor, a robot device or when the setting is off), the window and the
// acknowledgement clips to render; the edge partial carries the hub's end-of-turn score; a `vad` event with `resumed: true` says
// the person's voice came back after the edge partial and lasted 200 ms.
export type TalkOverLevel = "gentle" | "natural";
export type TurnEndLevel = "none" | "gentle" | "natural";
export interface TalkOverGrant { level: TalkOverLevel; window_ms: number; clips: readonly string[] }
export type SttServerMessage =
  | import("@maipai/spec/voice/ts/sttTypes.js").SttWireEvent
  | { t: "ready"; talk_over?: TalkOverGrant }
  | { t: "partial"; v: string; edge: true; end?: { score: number; level: TurnEndLevel } }
  | { t: "vad"; speaking: true; rms: number; resumed: true; voiced_ms: number }
  | { t: "timing"; speech_end_to_final_ms: number; silence_wait_ms: number };
export type SttServerMessageWithTiming = SttServerMessage;
import { z } from "zod";

/** STT-SMARTTURN-01: what the speculative start did on a turn, for the voice timing record (counts only). */
export type SpeculativeOutcome = "off" | "armed" | "started" | "confirmed" | "discarded";
export type TalkOverDecision = "none" | "confirmed" | "continued";
/** The optional labels and counts a client adds to its timing report, beside the speech-path stamps. */
export interface SttTimingExtras {
  head_ms?: number; offer_ms?: number; emit_ms?: number; ctx_enqueue?: string; ctx_emit?: string;
  speculative?: SpeculativeOutcome;
  talk_over_level?: "off" | TalkOverLevel; early_release_ms?: number; overlap_ms?: number; decision?: TalkOverDecision; yield_ms?: number;
}

/** Additive client timing report; all playback fields remain optional for older clients. */
export const SttTimingReportSchema = z.object({
  t: z.literal("timing"), turn_id: z.string(), stt_ms: z.number().finite().nonnegative(),
  first_playback_ms: z.number().finite().nonnegative().optional(), first_sentence_ms: z.number().finite().nonnegative().optional(),
  cue_playback_ms: z.number().finite().nonnegative().optional(),
  head_ms: z.number().finite().nonnegative().optional(), offer_ms: z.number().finite().nonnegative().optional(), emit_ms: z.number().finite().nonnegative().optional(),
  ctx_enqueue: z.string().max(20).optional(), ctx_emit: z.string().max(20).optional(),
  speculative: z.enum(["off", "armed", "started", "confirmed", "discarded"]).optional(),
  talk_over_level: z.enum(["off", "gentle", "natural"]).optional(), early_release_ms: z.number().finite().optional(), overlap_ms: z.number().finite().nonnegative().optional(),
  decision: z.enum(["none", "confirmed", "continued"]).optional(), yield_ms: z.number().finite().nonnegative().optional(),
}).strict();
