import { expect, test } from "bun:test";
import { commitDelay } from "../src/commitDelay";
import { PlaybackBuffer } from "../src/playbackBuffer";
import { decideBackchannel } from "../src/backchannel";
import { LinkModel } from "../src/netSim";
import { safeMetricRecord } from "../src/metrics";
import { History } from "../src/history";
import { TurnState } from "../public/turn-state.js";

test("adaptive commit delay waits on unfinished speech and low confidence", () => {
  expect(commitDelay("I was wondering if", 0.8)).toBe(1800);
  expect(commitDelay("I was wondering", 0.2)).toBe(1800);
  expect(commitDelay("I was wondering", 0.8)).toBe(900);
  expect(commitDelay("unfinished,", 0.8, 1600)).toBe(1800);
});

test("playback cursor survives appended audio and backs up exactly 120 ms", () => {
  const buffer = new PlaybackBuffer();
  buffer.append(Float32Array.from({ length: 24000 * 5 }, (_, i) => i));
  buffer.read(24000 * 2.3);
  buffer.pause();
  buffer.append(Float32Array.from({ length: 24000 * 3 }, (_, i) => i + 48000));
  const cursor = buffer.resume(24000);
  expect(cursor).toBeCloseTo(24000 * 2.18, 6);
  expect([...buffer.read(4)].map(Math.round)).toEqual([52320, 52321, 52322, 52323]);
});

test("link delay is per send and controls are protected from loss", () => {
  const link = new LinkModel(() => 0.99);
  const settings = { delayMs: 80, jitterMs: 0, lossPercent: 100, burstEveryMs: 0, burstStallMs: 0 };
  expect(link.schedule("audio", 1000, settings).dropped).toBe(true);
  expect(link.schedule("stop", 1010, settings, true).dropped).toBe(false);
  expect(link.schedule("next", 1020, settings).deliverAt).toBe(1100);
});

test("periodic stall adds only its remaining wait and preserves send order", () => {
  const link = new LinkModel(() => 0.5);
  const settings = { delayMs: 80, jitterMs: 0, lossPercent: 0, burstEveryMs: 7000, burstStallMs: 800 };
  expect(link.schedule("start", 0, settings).deliverAt).toBe(80);
  expect(link.schedule("stall", 7100, settings).deliverAt).toBe(7880);
  expect(link.schedule("after", 8000, settings).deliverAt).toBe(8080);
});

test("acknowledgement, interruption, and missing transcript stay distinct", () => {
  expect(decideBackchannel("Mm-hm!")).toBe("ack");
  expect(decideBackchannel("wait, stop")).toBe("interrupt");
  expect(decideBackchannel(" ")).toBe("unknown");
});

test("metric allow-list includes clocks and rejects text", () => {
  const clean = safeMetricRecord({ t_first_phrase_ready: 2, t_voice_first_audio: 3, t_first_frame_sent: 4, t_first_audio_scheduled: 5, output_latency_ms: 8, transcript: "private" });
  expect(clean).toEqual({ t_first_phrase_ready: 2, t_voice_first_audio: 3, t_first_frame_sent: 4, t_first_audio_scheduled: 5, output_latency_ms: 8 });
});

test("history trims only at the next user exchange boundary", () => {
  const history = new History("system");
  for (let i = 0; i < 41; i++) {
    history.commitUser(`u${i}`);
    history.commitToolExchange("checking", [{ id: `c${i}` }], [{ id: `c${i}`, content: "result" }]);
    history.commitAssistant(`a${i}`);
  }
  expect(history.messages[1]).toEqual({ role: "user", content: "u20" });
  expect(history.messages.some((message) => message.role === "tool" && message.tool_call_id === "c19")).toBe(false);
});

test("page turn state rejects late and stopped reply frames", () => {
  const state = new TurnState();
  expect(state.accepts(8)).toBe(true);
  expect(state.stop(8)).toBe(true);
  expect(state.accepts(8)).toBe(false);
  expect(state.accepts(7)).toBe(false);
  expect(state.accepts(9)).toBe(true);
});
