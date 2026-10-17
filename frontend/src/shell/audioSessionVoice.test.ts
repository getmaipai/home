import { afterEach, describe, expect, jest, test } from "bun:test";
import { audioSession, FADE_MS } from "@/shell/audioSession";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";

// Chat voice (spoken replies on Web Audio, read-aloud) joins the shell's one audio session.

class FakeParam { value = 1; }
class FakeAudioContext {
  currentTime = 0;
  state = "running";
  suspended = 0;
  resumed = 0;
  destination = {} as AudioNode;
  sources: Array<{ playbackRate: FakeParam; startedAt: number | undefined }> = [];
  gains: Array<{ gain: FakeParam }> = [];
  createGain() { const g = { connect: () => {}, gain: new FakeParam() }; this.gains.push(g); return g as unknown as GainNode; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect: () => {}, disconnect: () => {}, getByteTimeDomainData: (d: Uint8Array) => d.fill(128) } as unknown as AnalyserNode; }
  createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer; }
  createBufferSource() {
    const source = { buffer: null, playbackRate: new FakeParam(), startedAt: undefined as number | undefined, connect: () => {}, start: (when?: number) => { source.startedAt = when; }, onended: null };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  async decodeAudioData() { return { duration: 2 } as AudioBuffer; }
  async suspend() { this.suspended++; this.state = "suspended"; }
  async resume() { this.resumed++; this.state = "running"; }
  async close() {}
}

class FakeMedia extends EventTarget {
  paused = true; ended = false; playbackRate = 1; defaultPlaybackRate = 1; volume = 1; currentTime = 0; duration = 100;
  async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
  pause() { if (this.paused) return; this.paused = true; this.dispatchEvent(new Event("pause")); }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { jest.useRealTimers(); audioSession._reset(); });

describe("chat voice and the audio session", () => {
  test("a spoken reply pauses the media that plays, and media starting pauses the voice", async () => {
    const podcast = new FakeMedia();
    audioSession.registerElement(podcast as unknown as HTMLMediaElement, { kind: "podcast", item: { title: "Episode" } });
    await podcast.play();

    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("Hello there.");
    scheduler.finish();
    for (let i = 0; i < 6; i++) await settle();
    expect(context.sources.length).toBe(1);
    expect(podcast.paused).toBe(true);
    expect(audioSession.getSnapshot().current?.kind).toBe("spoken_reply");

    await podcast.play();
    expect(context.suspended).toBe(1);
    expect(audioSession.getSnapshot().current?.kind).toBe("podcast");
  });

  test("the spoken reply speed plays faster and shortens the schedule", async () => {
    audioSession.setSpeeds({ spoken_reply: 2 });
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("One.");
    scheduler.enqueueSentence("Two.");
    for (let i = 0; i < 10; i++) await settle();
    expect(context.sources.map((s) => s.playbackRate.value)).toEqual([2, 2]);
    // Each decoded sentence is 2 s long; at 2x the second starts 1 s after the first.
    expect(context.sources[1]!.startedAt! - context.sources[0]!.startedAt!).toBe(1);
    scheduler.stop();
  });

  test("stopping the reply releases the session", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("Hello.");
    for (let i = 0; i < 6; i++) await settle();
    expect(audioSession.getSnapshot().current?.kind).toBe("spoken_reply");
    scheduler.stop();
    expect(audioSession.getSnapshot().current).toBeNull();
  });

  test("the sleep timer fades and pauses a spoken reply", async () => {
    const context = new FakeAudioContext();
    const scheduler = new SentenceSpeechScheduler(context as unknown as AudioContext, async () => new Response(new Uint8Array(44)));
    scheduler.enqueueSentence("Hello.");
    for (let i = 0; i < 6; i++) await settle();
    jest.useFakeTimers();
    audioSession.startSleepTimer(15);
    jest.advanceTimersByTime(15 * 60_000 - FADE_MS + FADE_MS / 2);
    const fading = context.gains[0]!.gain.value;
    expect(fading).toBeLessThan(1);
    expect(context.suspended).toBe(0);
    jest.advanceTimersByTime(FADE_MS);
    expect(context.suspended).toBe(1);
    expect(context.gains[0]!.gain.value).toBe(1);
    jest.useRealTimers();
    scheduler.stop();
  });

  test("read-aloud takes focus from media and a preview at rate false stays at normal speed", () => {
    audioSession.setSpeeds({ spoken_reply: 1.5 });
    const context = new FakeAudioContext();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = class { constructor() { return context; } };
    const player = new StreamingWavPlayer({ rate: false });
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint16(34, 16, true);
    const body = new Uint8Array(8192);
    player.addChunk(header);
    player.addChunk(body);
    expect(context.sources[0]!.playbackRate.value).toBe(1);
    expect(audioSession.getSnapshot().current?.kind).toBe("spoken_reply");
    player.stop();
    expect(audioSession.getSnapshot().current).toBeNull();
  });
});
