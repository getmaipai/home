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
export type SttServerMessage = import("@maipai/spec/voice/ts/sttTypes.js").SttWireEvent | { t: "timing"; speech_end_to_final_ms: number; silence_wait_ms: number };
export type SttServerMessageWithTiming = SttServerMessage;
import { z } from "zod";

/** Additive client timing report; all playback fields remain optional for older clients. */
export const SttTimingReportSchema = z.object({
  t: z.literal("timing"), turn_id: z.string(), stt_ms: z.number().finite().nonnegative(),
  first_playback_ms: z.number().finite().nonnegative().optional(), first_sentence_ms: z.number().finite().nonnegative().optional(),
  head_ms: z.number().finite().nonnegative().optional(), offer_ms: z.number().finite().nonnegative().optional(), emit_ms: z.number().finite().nonnegative().optional(),
  ctx_enqueue: z.string().max(20).optional(), ctx_emit: z.string().max(20).optional(),
}).strict();
