import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { api } from "@/lib/api";
import { VoicePreviewController } from "@/lib/voice/voicePreviewPlayer";

class FakePlayer {
  onEnded?: () => void;
  stopped = false;
  addChunk() {}
  finish() { this.onEnded?.(); }
  stop() { this.stopped = true; }
}

afterEach(() => { mock.restore(); });

describe("VoicePreviewController", () => {
  test("starting a second preview aborts and stops the first", async () => {
    const signals: AbortSignal[] = [];
    spyOn(api, "previewVoice").mockImplementation(async (_id, signal) => {
      signals.push(signal!);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), { headers: { "content-type": "audio/wav" } });
    });
    const controller = new VoicePreviewController(() => new FakePlayer());
    void controller.start("one");
    void controller.start("two");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    controller.stop();
  });

  test("a failed request reports the error and resets to idle", async () => {
    spyOn(api, "previewVoice").mockRejectedValue(new Error("Home could not prepare this voice preview."));
    const controller = new VoicePreviewController(() => new FakePlayer());
    await controller.start("voice");
    expect(controller.getState()).toEqual({ voiceId: null, busy: false, error: "Home could not prepare this voice preview." });
  });
});
