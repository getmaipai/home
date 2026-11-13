// ECHO-GATE-01: on speakers, Home's own reply reaching the microphone never reaches the hub; a person clearly louder than that echo does.
import { describe, expect, test } from "bun:test";
import { BARGE_IN_RATIO, browserFamily, CALIBRATION_MS, createEchoGate, OPEN_AFTER_FRAMES } from "@/lib/voice/echoGate";

function frame(rms: number): Float32Array { const f = new Float32Array(320); for (let i = 0; i < f.length; i++) f[i] = rms * Math.SQRT2 * Math.sin(i / 3); return f; }

describe("ECHO-GATE-01", () => {
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
