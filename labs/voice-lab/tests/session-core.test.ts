import { expect, test } from "bun:test";
import { VoiceSession } from "../src/session";
import { config } from "../src/config";
import { TurnManager } from "../src/turnManager";
import { chatRequestBody } from "../src/stack";
import { encodeWav } from "../src/wav";
import { toolCapabilities } from "../src/tools";

type Timer = { at: number; fn: () => void; cancelled: boolean };
class FakeTime {
  now = 0;
  readonly timers = new Set<Timer>();
  setTimeout = ((fn: TimerHandler, delay = 0) => {
    const timer = { at: this.now + Number(delay), fn: fn as () => void, cancelled: false };
    this.timers.add(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const timer = handle as unknown as Timer;
    timer.cancelled = true;
    this.timers.delete(timer);
  }) as typeof clearTimeout;
  advance(ms: number) {
    this.now += ms;
    let next: Timer | undefined;
    while ((next = [...this.timers].filter((timer) => !timer.cancelled && timer.at <= this.now).sort((a, b) => a.at - b.at)[0])) {
      this.timers.delete(next);
      next.fn();
    }
  }
}

function audioFrame(voiced: boolean, marker = 0): Uint8Array {
  const bytes = new Uint8Array(512 * 4), view = new DataView(bytes.buffer);
  for (let i = 0; i < 512; i++) {
    const tone = voiced ? 0.1 * Math.sin(2 * Math.PI * 200 * i / config.sampleRate) : 0;
    view.setFloat32(i * 4, tone + marker, true);
  }
  return bytes;
}
function wavPcm(wav: Uint8Array): Float32Array {
  const out = new Float32Array(Math.floor((wav.length - 44) / 2));
  const view = new DataView(wav.buffer, wav.byteOffset + 44, out.length * 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32767;
  return out;
}
async function drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function harness(overrides: Record<string, unknown> = {}) {
  const time = new FakeTime();
  const sent: Array<string | Uint8Array> = [];
  const signals: AbortSignal[] = [];
  const deps = {
    now: () => time.now,
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    vad: { detect: (samples: Float32Array) => samples.some((sample) => Math.abs(sample) > 0.03) },
    transcribe: async (_wav: Uint8Array, signal?: AbortSignal) => { if (signal) signals.push(signal); return "heard words"; },
    turnCheck: async (_wav: Uint8Array, signal?: AbortSignal) => { if (signal) signals.push(signal); return { probability: 0.8, complete: true }; },
    chat: async function* (_messages: unknown[], signal: AbortSignal) { signals.push(signal); },
    speech: async () => new Response(encodeWav(new Float32Array(512))),
    prewarmChat: async (_messages: unknown[], _tools: unknown, signal: AbortSignal) => { signals.push(signal); return 0; },
    prewarmVoice: async (_voice: string, signal: AbortSignal) => { signals.push(signal); return 0; },
    appendMetrics: () => {},
    ...overrides,
  };
  const session = new VoiceSession({ readyState: 1, send: (value) => sent.push(value) }, "", deps as never);
  const feed = (voiced: boolean, frames = 1) => { for (let i = 0; i < frames; i++) { session.audio(audioFrame(voiced)); time.advance(32); } };
  const flush = async (ms = 0) => { time.advance(ms); await drain(); time.advance(0); await drain(); };
  const messages = () => sent.filter((value): value is string => typeof value === "string").map((value) => JSON.parse(value));
  return { session, time, sent, signals, feed, flush, messages };
}

test("1 recognizer gets 12 and 45 second utterances in order while turn check sees at most eight seconds", async () => {
  for (const seconds of [12, 45]) {
    const recognized: number[] = [];
    const modelSamples: number[] = [];
    const h = harness({
      transcribe: async (wav: Uint8Array) => { const n = wavPcm(wav).length; recognized.push(n); return `segment-${recognized.length}`; },
      turnCheck: async (wav: Uint8Array) => { modelSamples.push(wavPcm(wav).length); return { probability: 0.1, complete: true }; },
    });
    h.feed(true, seconds * 1000 / 32);
    h.feed(false, 8);
    await h.flush();
    expect(recognized.length).toBeGreaterThan(0);
    expect(recognized.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(seconds * config.sampleRate);
    expect(recognized.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual((seconds + 0.5) * config.sampleRate);
    expect(recognized.length).toBe(seconds === 12 ? 1 : 2);
    expect((h.session as any).tm.transcript).toBe(seconds === 12 ? "segment-1" : "segment-1 segment-2");
    expect(modelSamples.every((n) => n <= 8 * config.sampleRate)).toBe(true);
    h.session.close();
  }
});

test("2 forced cut-in keeps its opening frame and 300 ms pre-roll once", async () => {
  const recognized: Float32Array[] = [];
  const h = harness({
    transcribe: async (wav: Uint8Array) => { recognized.push(wavPcm(wav)); return recognized.length === 1 ? "the interruption" : "wait the interruption"; },
    chat: async function* () {},
  });
  h.feed(true, 4); h.feed(false, 8); await h.flush();
  expect(h.messages().some((message) => message.t === "final")).toBe(true);
  (h.session as any).heardAudio = true;
  h.time.advance(1600);
  h.feed(false, 10);
  h.feed(true, 44); await h.flush();
  expect((h.session as any).tm.state).toBe("user_speaking");
  h.feed(true, 5); h.feed(false, 8); await h.flush();
  expect(recognized.length).toBeGreaterThan(0);
  const utterance = recognized.at(-1)!;
  const preroll = config.sampleRate * config.prerollMs / 1000;
  expect(utterance.length).toBeGreaterThan(preroll + 44 * 512);
  expect(utterance.slice(0, preroll).every((sample) => Math.abs(sample) < 0.001)).toBe(true);
  expect(utterance.slice(preroll + 1, preroll + 512).some((sample) => Math.abs(sample) > 0.04)).toBe(true);
  expect(utterance.length).toBeLessThan(preroll + (44 + 5 + 20) * 512);
  h.session.close();
});

test("3 second check waits for its own score and ignores the cancelled check", async () => {
  let transcriptions = 0;
  let resolveSecondModel!: (value: { probability: number; complete: boolean }) => void;
  const h = harness({
    transcribe: async () => `turn-${++transcriptions}`,
    turnCheck: async (_wav: Uint8Array, signal?: AbortSignal) => {
      if (signal) hSignals.push(signal);
      if (modelCalls++ === 0) return { probability: 0.9, complete: true };
      return new Promise((resolve) => { resolveSecondModel = resolve; });
    },
  });
  const hSignals: AbortSignal[] = [];
  let modelCalls = 0;
  h.feed(true, 4); h.feed(false, 8); await h.flush();
  expect(h.messages().filter((message) => message.t === "final").length).toBe(1);
  h.session.message(JSON.stringify({ t: "played_end", turn: (h.session as any).turn }));
  h.feed(true, 4); h.feed(false, 8); await h.flush();
  expect((h.session as any).tm.transcript).toBe("turn-2");
  expect(h.messages().filter((message) => message.t === "final").length).toBe(1);
  h.feed(true, 4);
  expect(hSignals[1]?.aborted).toBe(true);
  resolveSecondModel({ probability: 0.99, complete: true }); await h.flush();
  expect(h.messages().filter((message) => message.t === "final").length).toBe(1);
  h.session.close();
});

test("4 speech before reply audio resumes the committed turn and replaces its transcript", async () => {
  const seenAudio: number[] = [];
  let transcriptions = 0;
  let draftSignal: AbortSignal | undefined;
  const h = harness({
    transcribe: async (wav: Uint8Array) => { seenAudio.push(wavPcm(wav).length); return ++transcriptions === 1 ? "first part" : "whole utterance"; },
    chat: async function* (_messages: unknown[], signal: AbortSignal) { draftSignal = signal; await new Promise<void>(() => {}); },
  });
  h.feed(true, 4); h.feed(false, 8); await h.flush();
  const beforeUsers = (h.session as any).history.messages.filter((message: any) => message.role === "user").length;
  expect(beforeUsers).toBe(1);
  h.feed(true, 5);
  expect(draftSignal?.aborted).toBe(true);
  h.feed(false, 8); await h.flush();
  expect(seenAudio[1]).toBeGreaterThan(seenAudio[0]!);
  expect((h.session as any).history.messages.filter((message: any) => message.role === "user").length).toBe(1);
  expect(h.messages().some((message) => message.t === "final" && message.text === "whole utterance")).toBe(true);
  h.session.close();
});

test("5 turn manager applies the adaptive 900 to 1800 ms fallback", () => {
  let now = 0;
  const manager = new TurnManager(() => now);
  const begin = () => { now = 0; manager.stop(); for (let i = 0; i < 4; i++) { now += 32; manager.frame(true, now); } for (let i = 0; i < 6; i++) { now += 32; manager.frame(false, now); } };
  begin();
  const revision = manager.checkRevision;
  manager.transcriptReady("finished phrase", now, revision);
  manager.turnModel(0.5, true, revision);
  now += 739; expect(manager.frame(false, now)).toHaveLength(0);
  now += 1; expect(manager.frame(false, now).some((command) => command.type === "commit")).toBe(true);
  begin();
  const unfinishedRevision = manager.checkRevision;
  manager.transcriptReady("and", now, unfinishedRevision);
  manager.turnModel(0.5, true, unfinishedRevision);
  now += 1639; expect(manager.frame(false, now)).toHaveLength(0);
  now += 1; expect(manager.frame(false, now).some((command) => command.type === "commit")).toBe(true);
  begin();
  const lowRevision = manager.checkRevision;
  manager.transcriptReady("finished", now, lowRevision);
  manager.turnModel(0.2, true, lowRevision);
  now += 1639; expect(manager.frame(false, now)).toHaveLength(0);
  now += 1; expect(manager.frame(false, now).some((command) => command.type === "commit")).toBe(true);
});

test("6 closing aborts work, clears timers, and prevents later sends", async () => {
  let resolveChat!: () => void;
  const warmSignals: AbortSignal[] = [];
  const h = harness({
    chat: async function* (_messages: unknown[], signal: AbortSignal) { hSignals.push(signal); await new Promise<void>((resolve) => { resolveChat = resolve; }); },
    prewarmChat: async (_messages: unknown[], _tools: unknown, signal: AbortSignal) => { warmSignals.push(signal); return new Promise<number>(() => {}); },
    prewarmVoice: async (_voice: string, signal: AbortSignal) => { warmSignals.push(signal); return new Promise<number>(() => {}); },
  });
  const hSignals: AbortSignal[] = [];
  h.session.message(JSON.stringify({ t: "hello", proto: 1 }));
  h.session.message(JSON.stringify({ t: "config", values: { netSim: { delayMs: 500 } } }));
  h.feed(true, 4); h.feed(false, 8); await h.flush();
  expect(h.time.timers.size).toBeGreaterThan(0);
  h.session.close();
  expect(h.time.timers.size).toBe(0);
  expect(hSignals.every((signal) => signal.aborted)).toBe(true);
  expect(warmSignals.length).toBe(2);
  expect(warmSignals.every((signal) => signal.aborted)).toBe(true);
  const sentAtClose = h.sent.length;
  resolveChat?.(); await h.flush(5000);
  expect(h.sent).toHaveLength(sentAtClose);
  expect((h.session as any).history.messages.some((message: any) => message.role === "assistant")).toBe(false);
  expect(h.time.timers.size).toBe(0);
});

test("7 chat request body pins id_slot zero", () => {
  expect(chatRequestBody([{ role: "user", content: "hello" }]).id_slot).toBe(0);
  expect(toolCapabilities).toEqual({ web_search: { readOnly: true }, get_time: { readOnly: true } });
});

test("7 a held tool draft stays private until commit and binds repeated tool results by call id", async () => {
  const seen: any[][] = [];
  const h = harness({
    chat: async function* (messages: any[]) {
      seen.push(messages);
      if (seen.length === 1) {
        yield { type: "tool_calls", calls: [
          { id: "call-tokyo", name: "get_time", arguments: { place: "Tokyo" } },
          { id: "call-london", name: "get_time", arguments: { place: "London" } },
        ] };
      } else yield { type: "text", text: "Here are both times." };
    },
    runTool: async (call: { arguments: Record<string, unknown> }) => `time:${call.arguments.place}`,
  });
  (h.session as any).held = true;
  const history = (h.session as any).history;
  await (h.session as any).reply("what time?", false);
  expect(history.messages).toHaveLength(1);
  expect(seen[1].filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m.content])).toEqual([
    ["call-tokyo", "time:Tokyo"], ["call-london", "time:London"],
  ]);
  (h.session as any).command({ type: "commit", transcript: "what time?", reason: "model" });
  expect(history.messages.filter((m: any) => m.role === "tool")).toHaveLength(2);
  expect(history.messages.filter((m: any) => m.role === "assistant" && m.tool_calls)).toHaveLength(1);
  h.session.close();
});

test("7 discarding a held draft leaves history unchanged", async () => {
  const h = harness({ chat: async function* () { yield { type: "tool_calls", calls: [{ id: "call-1", name: "get_time", arguments: { place: "Tokyo" } }] }; } });
  (h.session as any).held = true;
  await (h.session as any).reply("time?", false);
  const history = (h.session as any).history;
  expect(history.messages).toHaveLength(1);
  (h.session as any).command({ type: "cancel_held" });
  expect(history.messages).toHaveLength(1);
  h.session.close();
});

test("7 a cut-in while a draft tool waits keeps the completed exchange and spoken-status note", async () => {
  let finishTool!: (value: string) => void;
  let enteredTool!: () => void;
  const prompts: any[][] = [];
  const inTool = new Promise<void>((resolve) => { enteredTool = resolve; });
  const h = harness({
    chat: async function* (messages: any[]) { prompts.push(messages); if (prompts.length === 1) yield { type: "tool_calls", calls: [{ id: "weather-1", name: "web_search", arguments: { query: "weather" } }] }; else yield { type: "text", text: "Got it." }; },
    runTool: async () => { enteredTool(); return new Promise<string>((resolve) => { finishTool = resolve; }); },
  });
  (h.session as any).held = true;
  const reply = (h.session as any).reply("weather?", false);
  await inTool;
  (h.session as any).command({ type: "interrupt" });
  finishTool("sunny");
  await reply;
  const history = (h.session as any).history;
  expect(history.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "weather-1" && m.content === "sunny")).toBe(true);
  expect(history.messages.at(-1).content).toBe("[answer was not spoken]");
  await (h.session as any).reply("what about now?", true);
  expect(prompts[1].some((m) => m.role === "tool" && m.tool_call_id === "weather-1" && m.content === "sunny")).toBe(true);
  expect(prompts[1].at(-1).content).toBe("[answer was not spoken]");
  h.session.close();
});

test("7 repeated interruption does not duplicate the assistant message", () => {
  const h = harness();
  const history = (h.session as any).history;
  history.commitUser("question");
  (h.session as any).generatedText = "Heard answer";
  (h.session as any).command({ type: "interrupt" });
  (h.session as any).command({ type: "interrupt" });
  expect(history.messages.filter((m: any) => m.role === "assistant")).toHaveLength(1);
  expect(history.messages.at(-1).content).toContain("[cut off here by the person]");
  h.session.close();
});

test("8 cutoff note is stored once and never included in speech text", async () => {
  const speechText: string[] = [];
  let speechStarted!: () => void;
  let finishSpeech!: () => void;
  const started = new Promise<void>((resolve) => { speechStarted = resolve; });
  const response = new Promise<Response>((resolve) => { finishSpeech = () => resolve(new Response(encodeWav(new Int16Array(512)))); });
  const h = harness({
    speech: async (text: string) => { speechText.push(text); speechStarted(); return response; },
    chat: async function* () { yield { type: "text", text: "The exact answer." }; },
  });
  const history = (h.session as any).history;
  history.commitUser("question");
  const reply = (h.session as any).reply("question", true);
  await started;
  (h.session as any).chunkDurations[0] = 1;
  (h.session as any).playedMs[0] = 1;
  (h.session as any).command({ type: "interrupt" });
  finishSpeech();
  await reply;
  expect(history.messages.at(-1).content).toContain("[cut off here by the person]");
  expect(history.messages.at(-1).content).toContain("The exact answer.");
  expect(speechText).toEqual(["The exact answer."]);
  expect(speechText.join(" ")).not.toContain("cut off here");
  h.session.close();
});

test("6 style tags are sent only when the current voice supports them", async () => {
  for (const [styles, expected] of [[new Set<string>(), ""], [new Set(["whisper"]), "whisper"]] as const) {
    const sentStyles: string[] = [];
    const h = harness({
      supportedStyles: async () => new Set(styles),
      speech: async (_text: string, _signal: AbortSignal, opts: { style?: string }) => { sentStyles.push(opts.style ?? ""); return new Response(encodeWav(new Int16Array(512))); },
      chat: async function* () { yield { type: "text", text: "[whisper]Hello there." }; },
    });
    await (h.session as any).reply("question", true);
    expect(sentStyles).toEqual([expected]);
    h.session.close();
  }
});

test("6 empty voice audio retries without style then reports voice_failed", async () => {
  const styles: string[] = [];
  const metrics: any[] = [];
  let calls = 0;
  const h = harness({
    supportedStyles: async () => new Set(["whisper"]),
    speech: async (_text: string, _signal: AbortSignal, opts: { style?: string }) => { styles.push(opts.style ?? ""); calls++; return new Response(encodeWav(new Int16Array(0))); },
    chat: async function* () { yield { type: "text", text: "[whisper]Hello there." }; },
    appendMetrics: (_path: string, value: any) => metrics.push(value),
  });
  await (h.session as any).reply("question", true);
  await h.flush();
  expect(calls).toBe(2);
  expect(styles).toEqual(["whisper", ""]);
  expect(h.messages().some((message) => message.t === "error" && message.code === "voice_failed")).toBe(true);
  expect(metrics.some((value) => value.failure === "voice_failed" && value.ok === false)).toBe(true);
  h.session.close();
});

test("16 hello voice is used for prewarm and an unprepared voice falls back before speech", async () => {
  const warmed: string[] = [];
  const spoken: Array<{ voice?: string; style?: string }> = [];
  const h = harness({
    prewarmVoice: async (voice: string) => { warmed.push(voice); return 0; },
    voicePrepared: async () => false,
    speech: async (_text: string, _signal: AbortSignal, options: { voice?: string; style?: string }) => { spoken.push(options); return new Response(encodeWav(new Int16Array(512))); },
    chat: async function* () { yield { type: "text", text: "Hello there." }; },
  });
  h.session.message(JSON.stringify({ t: "hello", proto: 2, voice: "me" }));
  await drain();
  expect(warmed).toContain("me");
  await (h.session as any).reply("question", true);
  await h.flush();
  expect(spoken[0]?.voice).toBe("builtin");
  expect(h.messages().some((message) => message.t === "notice" && message.code === "voice_not_ready")).toBe(true);
  h.session.close();
});

test("5 old playback and local duck reports cannot affect the current turn", () => {
  const h = harness();
  const before = (h.session as any).heardAudio;
  h.session.message(JSON.stringify({ t: "played", turn: 0, chunk: 0, ms: 100 }));
  h.session.message(JSON.stringify({ t: "played_end", turn: 0 }));
  h.session.message(JSON.stringify({ t: "local_duck", turn: 0 }));
  expect((h.session as any).heardAudio).toBe(before);
  expect((h.session as any).metrics.t_local_duck).toBeUndefined();
  h.session.close();
});

test("11 hub timestamps a current local duck in cut-in metrics", () => {
  const records: any[] = [];
  const h = harness({ appendMetrics: (_path: string, value: any) => records.push(value) });
  h.session.message(JSON.stringify({ t: "local_duck", turn: (h.session as any).turn }));
  (h.session as any).writeCutin(true);
  expect(records.some((record) => record.backchannel === true && record.t_local_duck === 0)).toBe(true);
  h.session.close();
});

test("10 inbound microphone frames use the session link delay before reaching turn detection", async () => {
  const h = harness({ random: () => 0.5 });
  h.session.message(JSON.stringify({ t: "config", values: { netSim: { delayMs: 200, jitterMs: 0, lossPercent: 0, burstEveryMs: 0, burstStallMs: 0 } } }));
  h.feed(true, 4);
  expect((h.session as any).tm.state).toBe("idle");
  await h.flush(200);
  expect((h.session as any).tm.state).toBe("user_speaking");
  h.session.close();
});

test("10 outbound control and audio use the same configured link delay", async () => {
  const h = harness({ random: () => 0.5 });
  h.session.message(JSON.stringify({ t: "config", values: { netSim: { delayMs: 200, jitterMs: 0, lossPercent: 0, burstEveryMs: 0, burstStallMs: 0 } } }));
  (h.session as any).send({ t: "notice", code: "test" });
  (h.session as any).sendFrame(new Uint8Array([1, 2, 3]));
  await h.flush(199);
  expect(h.sent.some((value) => value instanceof Uint8Array)).toBe(false);
  expect(h.messages().some((message) => message.code === "test")).toBe(false);
  await h.flush(2);
  expect(h.sent.some((value) => value instanceof Uint8Array)).toBe(true);
  expect(h.messages().some((message) => message.code === "test")).toBe(true);
  h.session.close();
});

test("9 a chat reply with no synthesized audio logs a failed no_audio turn", async () => {
  const metrics: any[] = [];
  const h = harness({ chat: async function* () {}, appendMetrics: (_path: string, value: any) => metrics.push(value) });
  await (h.session as any).reply("question", true);
  expect(metrics.some((record) => record.ok === false && record.failure === "no_audio")).toBe(true);
  h.session.close();
});

function enterSpeakingState(session: VoiceSession, time: FakeTime) {
  const tm = (session as any).tm as TurnManager;
  tm.frame(true, time.now); time.advance(100); tm.frame(true, time.now);
  time.advance(32); tm.frame(false, time.now); time.advance(200); tm.frame(false, time.now);
  const revision = tm.checkRevision;
  tm.transcriptReady("earlier question", time.now, revision);
  tm.turnModel(0.9, true, revision);
  tm.firstAudioPlayed();
  return tm;
}

test("12 acknowledgement over a reply restores volume without pausing or starting another turn", async () => {
  const h = harness({ transcribe: async () => "mm-hm" });
  const tm = enterSpeakingState(h.session, h.time);
  (h.session as any).generatedText = "Still speaking";
  (h.session as any).cutInSamples = Array.from({ length: 512 * 5 }, () => 0.1);
  for (let i = 0; i < 5; i++) { h.time.advance(32); for (const c of tm.frame(true, h.time.now)) (h.session as any).command(c); }
  const turn = (h.session as any).turn;
  (h.session as any).sendFrame(new Uint8Array([1, 2, 3])); await h.flush();
  const audioFramesBeforeAck = h.sent.filter((value) => value instanceof Uint8Array).length;
  await (h.session as any).finishCutIn();
  await h.flush();
  (h.session as any).sendFrame(new Uint8Array([4, 5, 6])); await h.flush();
  expect(h.messages().some((message) => message.t === "resume" && message.turn === turn)).toBe(true);
  expect(h.messages().some((message) => message.t === "pause" || message.t === "stop")).toBe(false);
  expect(h.sent.filter((value) => value instanceof Uint8Array)).toHaveLength(audioFramesBeforeAck + 1);
  expect((h.session as any).turn).toBe(turn);
  h.session.close();
});

test("12 interruption phrase stops the reply and retains the whole phrase as the new turn audio", async () => {
  const h = harness({ transcribe: async () => "yeah actually I meant Thursday" });
  const tm = enterSpeakingState(h.session, h.time);
  const phrase = Array.from({ length: 512 * 12 }, (_, i) => i / 10000);
  (h.session as any).cutInSamples = phrase.slice();
  for (let i = 0; i < 12; i++) { h.time.advance(32); for (const c of tm.frame(true, h.time.now)) (h.session as any).command(c); }
  await (h.session as any).finishCutIn();
  await h.flush();
  expect(h.messages().some((message) => message.t === "stop")).toBe(true);
  expect((h.session as any).samples).toHaveLength(phrase.length);
  expect((h.session as any).samples[100]).toBeCloseTo(phrase[100]!);
  expect(tm.state).toBe("user_speaking");
  h.session.close();
});

test("12 empty interruption transcript remains lowered and undecided", async () => {
  const h = harness({ transcribe: async () => "" });
  const tm = enterSpeakingState(h.session, h.time);
  (h.session as any).cutInSamples = Array.from({ length: 512 * 5 }, () => 0.1);
  for (let i = 0; i < 5; i++) { h.time.advance(32); for (const c of tm.frame(true, h.time.now)) (h.session as any).command(c); }
  await (h.session as any).finishCutIn();
  await h.flush();
  expect(h.messages().some((message) => message.t === "duck")).toBe(true);
  expect(h.messages().some((message) => message.t === "pause" || message.t === "stop" || message.t === "resume")).toBe(false);
  expect(tm.cutting).toBe(true);
  h.session.close();
});

test("a piece that is only a sound tag is skipped and does not fail the reply", async () => {
  const spoken: string[] = [];
  const h = harness({
    speech: async (text: string) => { spoken.push(text); return new Response(encodeWav(new Int16Array(512))); },
    chat: async function* () { yield { type: "text", text: "[whisper] " }; yield { type: "text", text: "[laugh]. " }; yield { type: "text", text: "That is funny to me." }; },
  });
  (h.session as any).history.commitUser("question");
  await (h.session as any).reply("question", true);
  expect((h.session as any).metrics.failure).not.toBe("voice_failed");
  expect(spoken.every((t) => /[a-z]/i.test(t.replace(/\[[^\]]*\]/g, "")))).toBe(true);
  h.session.close();
});

test("a sound tag becomes the recorded sound between the two halves of the phrase, level-matched, and a tag with no sound is skipped", async () => {
  const spoken: string[] = []; const asked: Array<[string, string, number]> = [];
  const h = harness({
    speech: async (text: string) => { spoken.push(text); return new Response(encodeWav(new Int16Array(2400).fill(2000))); },
    sound: (voice: string, tag: string, rms: number) => { asked.push([voice, tag, rms]); return tag === "laugh" ? new Int16Array(7200).fill(1234) : null; },
    chat: async function* () { yield { type: "text", text: "Ha [laugh] that is funny, [sigh] really." }; },
  });
  (h.session as any).history.commitUser("question");
  await (h.session as any).reply("question", true);
  await h.flush(200);
  expect(spoken.map((t) => t.trim())).toEqual(["Ha", "that is funny,", "really."]);
  expect(asked.map((a) => a[1])).toEqual(["laugh", "sigh"]);
  expect(asked[0]![2]).toBeGreaterThan(0);
  const frames = h.sent.filter((v): v is Uint8Array => typeof v !== "string");
  const total = frames.reduce((n: number, f: Uint8Array) => n + (f.length - 8) / 2, 0);
  expect(total).toBeGreaterThanOrEqual(2400 * 3 + 7200);
  h.session.close();
});
