import { expect, test } from "bun:test";
import { isIOS, micConstraints, unlockAudio, installLifecycle, deviceVerdict } from "../public/device.js";
import { sanitizeDeviceReport } from "../src/deviceReport";
const em = () => { const h: Record<string, Array<() => void>> = {}; return { addEventListener: (t: string, f: () => void) => (h[t] ??= []).push(f), fire: (t: string) => (h[t] ?? []).forEach((f) => f()), h }; };
test("iPhone is detected, including an iPad that reports as a Mac; all three mic processors are on there", () => {
  expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true); expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe(true); expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0)).toBe(false);
  expect(micConstraints("remote-only", true)).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }); expect(micConstraints(false, false).echoCancellation).toBe(false);
});
test("unlocking audio resumes a suspended context and plays one silent sample, synchronously in the tap", () => {
  const calls: string[] = []; const ctx: any = { state: "suspended", sampleRate: 48000, destination: {}, resume: () => (calls.push("resume"), Promise.resolve()), createBuffer: () => ({}), createBufferSource: () => ({ connect: () => calls.push("connect"), start: () => calls.push("start") }) };
  unlockAudio(ctx); expect(calls).toEqual(["resume", "connect", "start"]);
  const running: any = { ...ctx, state: "running" }; calls.length = 0; unlockAudio(running); expect(calls).not.toContain("resume");
});
function setup(over: any = {}) {
  const doc: any = { ...em(), visibilityState: "visible" }, win: any = em(), dev: any = em(), cs: any = em(); let t = 1000; const log: string[] = [];
  const ctx: any = { ...cs, state: "running", sampleRate: 48000, resume: async () => { ctx.state = "running"; log.push("resume"); } }; const ws: any = { readyState: 1 }; const tracks: any[] = [{ readyState: "live" }];
  const lc = installLifecycle({ ctx, doc, nav: { mediaDevices: dev }, win, getWs: () => over.ws ?? ws, reconnect: () => log.push("reconnect"), getStream: () => ({ getAudioTracks: () => tracks }), rebuildMic: async () => { log.push("rebuild"); }, report: (w: string) => log.push("report:" + w), now: () => t, ...over.extra });
  return { doc, win, dev, ctx, log, ws, tracks, tick: (ms: number) => (t += ms), lc };
}
test("coming back after the screen was locked: audio resumes and the socket is reconnected", async () => {
  const s = setup(); s.ctx.state = "interrupted"; s.doc.visibilityState = "hidden"; s.doc.fire("visibilitychange"); s.tick(20_000); s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange"); await Bun.sleep(10);
  expect(s.log).toContain("resume"); expect(s.log).toContain("reconnect");
});
test("a quick tab switch does not reconnect a healthy socket", async () => { const s = setup(); s.doc.visibilityState = "hidden"; s.doc.fire("visibilitychange"); s.tick(500); s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange"); await Bun.sleep(10); expect(s.log).not.toContain("reconnect"); });
test("a route change that changes the sample rate or ends the mic track rebuilds the microphone path; a route change with nothing wrong does not", async () => {
  const a = setup(); a.dev.fire("devicechange"); await Bun.sleep(10); expect(a.log).not.toContain("rebuild");
  const b = setup(); b.ctx.sampleRate = 24000; b.dev.fire("devicechange"); await Bun.sleep(10); expect(b.log).toContain("rebuild");
  const c = setup(); c.tracks[0].readyState = "ended"; c.win.fire("pageshow"); await Bun.sleep(10); expect(c.log).toContain("rebuild");
});
test("the device check gives one plain fix, in order of what blocks most", () => {
  const ok = { secure: true, worklet: true, ctxState: "running", micLevelPeak: 0.08, echoCancel: true, ios: true, toneHeard: true, roundTripMs: 120 };
  expect(deviceVerdict(ok)).toEqual({ pass: true, fix: null });
  expect(deviceVerdict({ ...ok, secure: false }).fix).toContain("https"); expect(deviceVerdict({ ...ok, micError: "NotAllowedError" }).fix).toContain("Settings, Safari, Microphone");
  expect(deviceVerdict({ ...ok, ctxState: "suspended" }).fix).toContain("Audio is not running"); expect(deviceVerdict({ ...ok, micLevelPeak: 0 }).fix).toContain("hears nothing");
  expect(deviceVerdict({ ...ok, echoCancel: false }).fix).toContain("echo canceller"); expect(deviceVerdict({ ...ok, echoCancel: false, ios: false }).pass).toBe(true);
  expect(deviceVerdict({ ...ok, toneHeard: false }).fix).toContain("test tone"); expect(deviceVerdict({ ...ok, roundTripMs: 700 }).fix).toContain("700 ms");
});
test("the page's report to the log keeps short plain fields only and never a secret or nested object", () => {
  const r = sanitizeDeviceReport({ event: "start", ctxRate: 48000, secret: "x", ios: true, nested: { a: 1 }, fix: "y".repeat(500), micLevel: NaN }, "UA".repeat(200));
  expect(r.secret).toBeUndefined(); expect(r.nested).toBeUndefined(); expect((r.fix as string).length).toBe(120); expect((r.ua as string).length).toBe(120); expect(r.micLevel).toBeUndefined(); expect(r.ctxRate).toBe(48000);
});
import { readFileSync } from "node:fs";
test("page self-check: the Start tap unlocks audio before its first await, and the device check button exists", () => {
  const app = readFileSync(`${import.meta.dir}/../public/app.js`, "utf8"), i = app.indexOf("$('#start').onclick"), body = app.slice(i, i + 1500);
  expect(body.indexOf("unlockAudio(")).toBeGreaterThan(0); expect(body.indexOf("unlockAudio(")).toBeLessThan(body.indexOf("await "));
  expect(readFileSync(`${import.meta.dir}/../public/index.html`, "utf8")).toContain('id="deviceCheck"');
  expect(app).toContain("installLifecycle("); expect(app).toContain("micConstraints(");
});
