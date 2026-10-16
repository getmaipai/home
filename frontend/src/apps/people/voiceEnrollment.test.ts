import { describe, expect, test } from "bun:test";
import { audioBlobToWav16k } from "@/apps/people/voiceEnrollment";

describe("audioBlobToWav16k", () => {
  test("writes the WAV contract header for mono 16 kHz PCM", async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalOfflineAudioContext = globalThis.OfflineAudioContext;
    class FakeAudioContext {
      async decodeAudioData() { return { length: 4, sampleRate: 16_000 } as AudioBuffer; }
      async close() {}
    }
    class FakeOfflineAudioContext {
      destination = {} as AudioDestinationNode;
      constructor(public channels: number, public length: number, public sampleRate: number) {}
      createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
      async startRendering() { return { getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]) } as unknown as AudioBuffer; }
    }
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    globalThis.OfflineAudioContext = FakeOfflineAudioContext as unknown as typeof OfflineAudioContext;
    try {
      const wav = await audioBlobToWav16k(new Blob(["audio"]));
      const bytes = new DataView(await wav.arrayBuffer());
      expect(wav.type).toBe("audio/wav");
      expect(bytes.getUint16(22, true)).toBe(1);
      expect(bytes.getUint32(24, true)).toBe(16_000);
      expect(bytes.getUint16(34, true)).toBe(16);
      expect(bytes.getUint32(40, true)).toBe(8);
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.OfflineAudioContext = originalOfflineAudioContext;
    }
  });
});
