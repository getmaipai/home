import { describe, expect, test } from "bun:test";
import { VoiceTimingMessageSchema } from "@/lib/voiceTiming";

describe("voice timing speculative outcomes", () => {
  test("accepts the interruption held-run label as counts-only timing", () => {
    const parsed = VoiceTimingMessageSchema.safeParse({ t: "timing", turn_id: "turn-test", stt_ms: 0, speculative: "interrupt_started" });
    expect(parsed.success).toBe(true);
  });
});
