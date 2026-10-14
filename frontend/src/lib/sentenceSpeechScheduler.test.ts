import { describe, expect, test } from "bun:test";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

class FakeAudioContext {
  destination = {} as AudioNode;
  currentTime = 0;
  createGain() { return { connect: () => {}, gain: { value: 1 } } as unknown as GainNode; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect: () => {}, disconnect: () => {}, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) } as unknown as AnalyserNode; }
  createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, onended: null } as unknown as AudioBufferSourceNode; }
  async decodeAudioData() { return { duration: 2 } as AudioBuffer; }
  async close() {}
}

function fakeAudioContext() { return new FakeAudioContext() as unknown as AudioContext; }

async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("sentence speech scheduler", () => {
  test("stop aborts sentence fetches still in flight and reports no error", async () => {
    const context = fakeAudioContext();
    let signal: AbortSignal | undefined;
    const speechStream = (_text: string, received?: AbortSignal): Promise<Response> => {
      signal = received;
      return new Promise<Response>((_resolve, reject) => received?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    };
    const scheduler = new SentenceSpeechScheduler(context, speechStream);
    let errors = 0;
    scheduler.onError = () => { errors++; };
    scheduler.enqueueSentence("still fetching", { turnId: "t1", generation: 3 });
    await settle();
    scheduler.stop();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(errors).toBe(0);
  });

});
