import { expect, test } from "bun:test";
import { SttTimingReportSchema } from "./sttContract";

test("timing report accepts the additive playback stamps and older clients", () => {
  expect(SttTimingReportSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240 }).success).toBe(true);
  expect(SttTimingReportSchema.safeParse({ t: "timing", turn_id: "turn-1", stt_ms: 240, first_playback_ms: 800, head_ms: 100, offer_ms: 250, emit_ms: 275, ctx_enqueue: "suspended", ctx_emit: "running" }).success).toBe(true);
});
