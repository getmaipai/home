import { expect, test } from "bun:test";
import { VoiceSession } from "../src/session";
import { config } from "../src/config";
import { commitDelay } from "../src/commitDelay";

function frame(speech: boolean, marker: number, tone = false): Uint8Array {
  const bytes = new Uint8Array(512 * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 512; i++) {
    const sample = speech && tone ? 0.1 * Math.sin(2 * Math.PI * 200 * i / config.sampleRate) : speech ? 0.1 : 0;
    view.setFloat32(i * 4, sample + marker / 100000, true);
  }
  return bytes;
}
function harness(transcriber: (wav: Uint8Array) => Promise<string> = async () => "ok") {
  const sent: Array<string | Uint8Array> = [];
  let now = 0;
  const session = new VoiceSession({ readyState: 1, send: (v) => sent.push(v) }, "", {
    now: () => now,
    vad: { detect: (samples) => samples.some((sample) => Math.abs(sample) > 0.05) },
    transcribe: async (wav) => transcriber(wav),
    turnCheck: async () => ({ probability: 0.8, complete: true }),
    chat: async function* () {},
    speech: async () => new Response(new Uint8Array(44)),
    setTimeout: ((fn: TimerHandler, delay?: number) => { return setTimeout(fn, delay); }) as typeof setTimeout,
  });
  return { session, sent, tick: (ms: number) => { now += ms; }, feed: (talk: boolean, marker: number, tone = false) => { session.audio(frame(talk, marker, tone)); now += 32; } };
}

test("session seam accepts synthetic 32 ms speech and silence frames", () => {
  const h = harness();
  h.feed(true, 1, true); h.feed(false, 0);
  h.session.close();
  expect(h.sent).toEqual([]);
});

test("adaptive manager fallback uses 900 ms or 1800 ms as indicated", () => {
  expect(commitDelay("unfinished and", 0.8)).toBe(1800);
  expect(commitDelay("finished", 0.2)).toBe(1800);
  expect(commitDelay("finished", 0.8)).toBe(900);
});
