import { describe, expect, test } from "bun:test";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { ApiError } from "@/lib/api";

class FakeAudioContext {
  started = 0;
  startTimes: number[] = [];
  destination = {} as AudioNode;
  currentTime = 0;
  suspended = 0;
  resumed = 0;
  async suspend() { this.suspended++; }
  async resume() { this.resumed++; }
  createGain() { return { connect: () => {}, gain: { value: 1 } } as unknown as GainNode; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect: () => {}, disconnect: () => {}, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) } as unknown as AnalyserNode; }
  createBufferSource() { return { buffer: null, connect: () => {}, start: (when?: number) => { this.started++; this.startTimes.push(when ?? this.currentTime); }, onended: null } as unknown as AudioBufferSourceNode; }
  async decodeAudioData() { return { duration: 2 } as AudioBuffer; }
  async close() {}
}

function fakeAudioContext() { return new FakeAudioContext() as unknown as AudioContext; }

async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

class StreamingFakeAudioContext extends FakeAudioContext {
  decoded = 0;
  buffers: number[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    this.buffers.push(length);
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
  async decodeAudioData() { this.decoded++; return { duration: 2 } as AudioBuffer; }
}

function wavHeader(channels = 1, rate = 24_000, bits = 16): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494646, false); view.setUint32(4, 0x7fffffff, true); view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * (bits / 8), true); view.setUint16(32, channels * (bits / 8), true); view.setUint16(34, bits, true);
  view.setUint32(36, 0x64617461, false); view.setUint32(40, 0x7fffffff, true);
  return bytes;
}

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return { response: new Response(stream), push: (bytes: Uint8Array) => controller.enqueue(bytes), end: () => controller.close() };
}

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

  test("pause and resume suspend and resume once, and pause after stop is safe", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.pause(); scheduler.pause(); scheduler.resume(); scheduler.resume();
    expect(context.suspended).toBe(1); expect(context.resumed).toBe(1);
    scheduler.stop(); scheduler.pause(); scheduler.resume();
    expect(context.suspended).toBe(1); expect(context.resumed).toBe(1);
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

  test("heardVisibleEndFine counts inside the sentence that is playing and freezes at stop", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("first", { visibleEnd: 10 });
    scheduler.enqueueSentence("second", { visibleEnd: 30 });
    await settle(); await settle(); await settle(); await settle();
    context.currentTime = 1;
    const midFirst = scheduler.heardVisibleEndFine();
    expect(midFirst).toBeGreaterThan(0);
    expect(midFirst).toBeLessThan(10);
    context.currentTime = 3;
    const midSecond = scheduler.heardVisibleEndFine();
    expect(midSecond).toBeGreaterThan(10);
    expect(midSecond).toBeLessThan(30);
    scheduler.stop();
    context.currentTime = 4;
    expect(scheduler.heardVisibleEndFine()).toBe(midSecond);
  });

  test("wasCutOff is true only when stop ran before the reply ended on its own", async () => {
    const context = new FakeAudioContext();
    const cut = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    cut.enqueueSentence("first", { visibleEnd: 5 });
    await settle(); await settle(); await settle(); await settle();
    expect(cut.wasCutOff()).toBe(false);
    cut.stop();
    expect(cut.wasCutOff()).toBe(true);
    const quiet = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    quiet.finish();
    await settle(); await settle();
    quiet.stop();
    expect(quiet.wasCutOff()).toBe(false);
  });

  test("playedMs is 0 before any sentence plays and follows the audio clock after", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    expect(scheduler.playedMs()).toBe(0);
    scheduler.enqueueSentence("first", { visibleEnd: 5 });
    await settle(); await settle(); await settle(); await settle();
    context.currentTime = 1.5;
    expect(scheduler.playedMs()).toBeCloseTo(1500, 0);
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


  test("a sentence starts playing while it is still arriving, not after all of it", async () => {
    const context = new StreamingFakeAudioContext();
    const stream = controlledStream();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => stream.response);
    scheduler.enqueueSentence("hello there", { visibleEnd: 11 });
    stream.push(wavHeader());
    stream.push(new Uint8Array(6_000));
    for (let i = 0; i < 6; i++) await settle();
    expect(context.started).toBeGreaterThanOrEqual(1);
    const early = context.started;
    stream.push(new Uint8Array(30_000));
    stream.end();
    scheduler.finish();
    for (let i = 0; i < 6; i++) await settle();
    expect(context.started).toBeGreaterThan(early);
    expect(context.decoded).toBe(0);
  });

  test("a later sentence's audio waits for the earlier sentence to finish arriving, so order is kept", async () => {
    const context = new StreamingFakeAudioContext();
    const first = controlledStream();
    const second = controlledStream();
    const streams = [first, second];
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => streams.shift()!.response);
    scheduler.enqueueSentence("one", { visibleEnd: 3 });
    scheduler.enqueueSentence("two", { visibleEnd: 6 });
    second.push(wavHeader()); second.push(new Uint8Array(8_000));
    for (let i = 0; i < 6; i++) await settle();
    expect(context.started).toBe(0);
    first.push(wavHeader()); first.push(new Uint8Array(8_000)); first.end();
    for (let i = 0; i < 8; i++) await settle();
    expect(context.started).toBeGreaterThanOrEqual(2);
    second.end();
  });

  test("stereo audio is collected and decoded whole instead of cut", async () => {
    const context = new StreamingFakeAudioContext();
    const stream = controlledStream();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => stream.response);
    scheduler.enqueueSentence("hello", { visibleEnd: 5 });
    stream.push(wavHeader(2));
    stream.push(new Uint8Array(4_000));
    stream.end();
    scheduler.finish();
    for (let i = 0; i < 8; i++) await settle();
    expect(context.decoded).toBe(1);
    expect(context.started).toBe(1);
  });

  test("the first sentence's visible end counts when its first buffer starts, later buffers add none", async () => {
    const context = new StreamingFakeAudioContext();
    const stream = controlledStream();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => stream.response);
    scheduler.enqueueSentence("hello there", { visibleEnd: 11 });
    stream.push(wavHeader()); stream.push(new Uint8Array(40_000)); stream.end();
    scheduler.finish();
    for (let i = 0; i < 8; i++) await settle();
    context.currentTime = 0.01;
    expect(scheduler.heardVisibleEnd()).toBe(11);
  });
});
