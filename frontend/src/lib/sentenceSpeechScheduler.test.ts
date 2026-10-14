import { describe, expect, test } from "bun:test";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { ApiError } from "@/lib/api";

class FakeAudioContext {
  started = 0;
  startTimes: number[] = [];
  destination = {} as AudioNode;
  currentTime = 0;
  createGain() { return { connect: () => {}, gain: { value: 1 } } as unknown as GainNode; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect: () => {}, disconnect: () => {}, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) } as unknown as AnalyserNode; }
  createBufferSource() { return { buffer: null, connect: () => {}, start: (when?: number) => { this.started++; this.startTimes.push(when ?? this.currentTime); }, onended: null } as unknown as AudioBufferSourceNode; }
  async decodeAudioData() { return { duration: 2 } as AudioBuffer; }
  async close() {}
}

function fakeAudioContext() { return new FakeAudioContext() as unknown as AudioContext; }

async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("sentence speech scheduler", () => {
  test("a cut TTS body drops the whole sentence but later sentences still schedule in order", async () => {
    const context = new FakeAudioContext();
    let calls = 0;
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => {
      calls++;
      if (calls === 1) {
        const response = new Response(new Uint8Array([1, 2, 3]));
        Object.defineProperty(response, "arrayBuffer", { value: async () => { throw new Error("Stack dropped mid-synthesis"); } });
        return response;
      }
      return new Response(new Uint8Array(44));
    });
    let errors = 0;
    scheduler.onError = () => { errors++; };
    scheduler.enqueueSentence("first");
    scheduler.enqueueSentence("second");
    scheduler.enqueueSentence("third");
    scheduler.finish();
    for (let i = 0; i < 8; i++) await settle();
    expect(errors).toBe(1);
    expect(context.started).toBe(2);
  });

  test("a cancelled turn does not report a speech failure", async () => {
    const scheduler = new SentenceSpeechScheduler(fakeAudioContext(), async () => { throw new ApiError("cancelled", 409, "turn_cancelled"); });
    let errors = 0;
    scheduler.onError = () => { errors++; };
    scheduler.enqueueSentence("stopped reply");
    scheduler.finish();
    for (let i = 0; i < 4; i++) await settle();
    expect(errors).toBe(0);
  });

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

  test("heardVisibleEnd counts only sentences whose audio has started", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("first", { visibleEnd: 5 });
    scheduler.enqueueSentence("second", { visibleEnd: 12 });
    scheduler.enqueueSentence("third", { visibleEnd: 20 });
    await settle(); await settle(); await settle(); await settle();
    context.currentTime = 1;
    expect(scheduler.heardVisibleEnd()).toBe(5);
    context.currentTime = 3;
    expect(scheduler.heardVisibleEnd()).toBe(12);
  });

  test("heardVisibleEnd ignores a cue with no visibleEnd", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("cue");
    scheduler.enqueueSentence("visible", { visibleEnd: 9 });
    await settle(); await settle(); await settle(); await settle();
    expect(context.startTimes).toEqual([0, 2]);
    expect(scheduler.heardVisibleEnd()).toBe(0);
    context.currentTime = 2;
    expect(scheduler.heardVisibleEnd()).toBe(9);
  });

  test("heardVisibleEnd stays readable after stop", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("first", { visibleEnd: 7 });
    await settle(); await settle();
    context.currentTime = 1;
    scheduler.stop();
    expect(scheduler.heardVisibleEnd()).toBe(7);
  });

});
