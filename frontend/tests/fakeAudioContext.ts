/** happy-dom (tests/preload.ts) has no Web Audio API at all - this stub
 * exists purely so streamingWavPlayer.ts's/sentenceSpeechScheduler.ts's
 * constructors don't throw in tests, not to fake around a real
 * environment limitation. `decodeAudioData` (sentenceSpeechScheduler.ts's
 * own dependency, unlike streamingWavPlayer.ts's hand-rolled decode) just
 * returns a fixed-duration fake buffer - nothing asserts on real decoded
 * sample data. Shared by every test that exercises TTS playback
 * (chatModelAdapter.test.ts, chatListenStore.test.ts) - previously
 * duplicated per test file (ChatPage.test.tsx, pre-assistant-ui). */
export class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createBuffer(_numChannels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  decodeAudioData(_arrayBuffer: ArrayBuffer) {
    return Promise.resolve({ duration: 0.1 });
  }
  createBufferSource() {
    const source: {
      buffer: unknown;
      onended: (() => void) | null;
      connect: () => void;
      start: () => void;
    } = {
      buffer: null,
      onended: null,
      connect: () => {},
      start: () => {
        setTimeout(() => source.onended?.(), 0);
      },
    };
    return source;
  }
  close() {
    return Promise.resolve();
  }
}

/** A minimal, real 44-byte WAV header (no PCM samples needed) - a
 * response body streamingWavPlayer.ts/sentenceSpeechScheduler.ts can
 * parse without throwing. */
export function fakeWavBody(): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  return header;
}
