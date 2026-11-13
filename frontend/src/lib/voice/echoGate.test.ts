// ECHO-GATE-01: on speakers, Home's own reply reaching the microphone never reaches the hub; a person clearly louder than that echo does.
import { describe, expect, test } from "bun:test";
import { BARGE_IN_RATIO, browserFamily, CALIBRATION_MS, createEchoGate, OPEN_AFTER_FRAMES } from "@/lib/voice/echoGate";

function frame(rms: number): Float32Array { const f = new Float32Array(320); for (let i = 0; i < f.length; i++) f[i] = rms * Math.SQRT2 * Math.sin(i / 3); return f; }

describe("ECHO-GATE-01", () => {
  test("playback envelope tracks changing loudness so a person can cut in on a quiet syllable", () => {
    let now = 0;
    const gate = createEchoGate({ now: () => now });
    gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20; i++) {
      const loud = Math.floor(now / 200) % 2 === 0;
      gate.pass(frame(loud ? 0.1 : 0.01), true, now, loud ? 0.5 : 0.05);
      now += 20;
    }
    for (let i = 0; i < 12; i++) {
      const loud = Math.floor(now / 200) % 2 === 0;
      expect(gate.pass(frame(loud ? 0.1 : 0.01), true, now, loud ? 0.5 : 0.05)).toBe(false);
      now += 20;
    }
    while (Math.floor(now / 200) % 2 !== 0) { gate.pass(frame(0.01), true, now, 0.05); now += 20; }
    const results: boolean[] = [];
    for (let i = 0; i < OPEN_AFTER_FRAMES; i++) {
      results.push(gate.pass(frame(0.06), true, now, 0.05));
      now += 20;
    }
    expect(results.slice(0, OPEN_AFTER_FRAMES - 1).every((result) => !result)).toBe(true);
    expect(results[OPEN_AFTER_FRAMES - 1]).toBe(true);
  });

  test("a person at 0.3 cuts in over loud playback", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 5; i++) { gate.pass(frame(0.1), true, now, 0.5); now += 20; }
    const results = Array.from({ length: OPEN_AFTER_FRAMES }, () => { const result = gate.pass(frame(0.3), true, now, 0.5); now += 20; return result; });
    expect(results.at(-1)).toBe(true);
  });

  test("steady echo remains blocked for a person below the barge-in ratio", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 20; i++) { expect(gate.pass(frame(i < CALIBRATION_MS / 20 ? 0.1 : 0.12), true, now, 0.5)).toBe(false); now += 20; }
  });

  test("coupling and threshold are null before calibration and populated after", () => {
    const gate = createEchoGate({ now: () => 0 });
    expect(gate.report().coupling).toBeNull();
    expect(gate.report().threshold_rms).toBeNull();
    gate.replyStarted(0);
    for (let i = 0; i < CALIBRATION_MS / 20; i++) gate.pass(frame(0.05), true, i * 20, 0.5);
    gate.pass(frame(0.05), true, CALIBRATION_MS, 0.5);
    expect(gate.report().coupling).toBeGreaterThan(0);
    expect(gate.report().threshold_rms).toBeGreaterThan(0);
  });

  test("a talk-over does not teach coupling or raise the threshold", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20; i++) { gate.pass(frame(0.1), true, now, 0.5); now += 20; }
    for (let i = 0; i < 20; i++) { gate.pass(frame(0.1), true, now, 0.5); now += 20; }
    const before = gate.report();
    for (let i = 0; i < 150; i++) { gate.pass(frame(0.3), true, now, 0.5); now += 20; }
    const after = gate.report();
    expect(Math.abs(after.coupling! - before.coupling!) / before.coupling!).toBeLessThanOrEqual(0.05);
    expect(Math.abs(after.threshold_rms! - before.threshold_rms!) / before.threshold_rms!).toBeLessThanOrEqual(0.05);
  });

  test("blocked echo stays blocked after a talk-over and a second talk-over still opens", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20; i++) { gate.pass(frame(0.1), true, now, 0.5); now += 20; }
    for (let i = 0; i < 150; i++) { gate.pass(frame(0.3), true, now, 0.5); now += 20; }
    now += 500;
    for (let i = 0; i < 40; i++) { expect(gate.pass(frame(0.1), true, now, 0.5)).toBe(false); now += 20; }
    const results = Array.from({ length: OPEN_AFTER_FRAMES }, () => { const result = gate.pass(frame(0.3), true, now, 0.5); now += 20; return result; });
    expect(results.at(-1)).toBe(true);
  });

  test("a genuinely doubled steady echo is learned while blocked", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20; i++) { gate.pass(frame(0.1), true, now, 0.5); now += 20; }
    const initial = gate.report().coupling!;
    for (let i = 0; i < 250; i++) { expect(gate.pass(frame(0.2), true, now, 0.5)).toBe(false); now += 20; }
    expect(gate.report().coupling!).toBeGreaterThanOrEqual(initial * 1.9);
  });

  test("legacy calibration caps its flat reference at 0.06", () => {
    let now = 0; const gate = createEchoGate({ now: () => now }); gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 2; i++) { gate.pass(frame(0.1), true, now); now += 20; }
    const results = Array.from({ length: OPEN_AFTER_FRAMES }, () => { const result = gate.pass(frame(0.25), true, now); now += 20; return result; });
    expect(results.at(-1)).toBe(true);
  });

  test("while she is silent every frame passes and the room noise is measured; while she plays, the echo calibrates and frames at its level are dropped", () => {
    let now = 0;
    const gate = createEchoGate({ now: () => now });
    for (let i = 0; i < 20; i++) { expect(gate.pass(frame(0.002), false, now)).toBe(true); now += 20; }
    gate.replyStarted(now);
    // The first reply: 1.5 s of echo at 0.05 calibrates, nothing passes meanwhile.
    for (let i = 0; i < CALIBRATION_MS / 20; i++) { expect(gate.pass(frame(0.05), true, now)).toBe(false); now += 20; }
    // After calibration the same echo keeps being dropped.
    for (let i = 0; i < 50; i++) { expect(gate.pass(frame(0.05), true, now)).toBe(false); now += 20; }
    const report = gate.report();
    expect(report.echo_rms).toBeGreaterThan(0.04);
    expect(report.silence_rms).toBeLessThan(0.01);
    expect(report.ratio_db).toBeGreaterThan(20);
    expect(report.passed).toBe(0);
    expect(report.blocked).toBeGreaterThan(100);
  });

  test("a person clearly louder than the echo opens the gate after a few frames and it stays open through quieter syllables; a single click does not open it", () => {
    let now = 0;
    const gate = createEchoGate({ now: () => now });
    gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 5; i++) { gate.pass(frame(0.05), true, now); now += 20; }
    gate.report();
    // One loud click: dropped.
    expect(gate.pass(frame(0.05 * BARGE_IN_RATIO * 2), true, now)).toBe(false); now += 20;
    expect(gate.pass(frame(0.05), true, now)).toBe(false); now += 20;
    // The person talks over her: loud for OPEN_AFTER_FRAMES frames, then the gate is open and a quieter syllable passes too.
    const results: boolean[] = [];
    for (let i = 0; i < OPEN_AFTER_FRAMES; i++) { results.push(gate.pass(frame(0.05 * BARGE_IN_RATIO * 2), true, now)); now += 20; }
    expect(results[OPEN_AFTER_FRAMES - 1]).toBe(true);
    expect(gate.pass(frame(0.05), true, now)).toBe(true); now += 20; // inside the hold
    now += 500;
    expect(gate.pass(frame(0.05), true, now)).toBe(false); // the hold ran out: echo again
    const report = gate.report();
    expect(report.passed).toBeGreaterThanOrEqual(2);
  });

  test("a later, louder reply raises the reference at once; a quieter one lowers it slowly", () => {
    let now = 0;
    const gate = createEchoGate({ now: () => now });
    gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 2; i++) { gate.pass(frame(0.02), true, now); now += 20; }
    const first = gate.report().echo_rms!;
    gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 2; i++) { gate.pass(frame(0.08), true, now); now += 20; }
    const louder = gate.report().echo_rms!;
    expect(louder).toBeGreaterThan(first * 3);
    gate.replyStarted(now);
    for (let i = 0; i < CALIBRATION_MS / 20 + 2; i++) { gate.pass(frame(0.02), true, now); now += 20; }
    const after = gate.report().echo_rms!;
    expect(after).toBeLessThan(louder);
    expect(after).toBeGreaterThan(first * 2); // lowered only part of the way
  });

  test("the browser family is one token", () => {
    expect(browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")).toBe("chrome");
    expect(browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("safari");
    expect(browserFamily("Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/132.0")).toBe("firefox");
    expect(browserFamily("Mozilla/5.0 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("edge");
  });
});
