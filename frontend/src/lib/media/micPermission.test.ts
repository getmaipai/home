import { describe, expect, test } from "bun:test";
import { classifyMicError, detectBrowser, probeMic } from "./micPermission";

const stream = () => ({ getTracks: () => [{ stop() { stopped++; } }] }) as unknown as MediaStream;
let stopped = 0;
const reject = (name: string) => () => Promise.reject(Object.assign(new Error(name), { name }));

describe("probeMic", () => {
  test("prompt asks once and stops the probe stream", async () => {
    stopped = 0;
    let calls = 0;
    const r = await probeMic({ isSecureContext: true, query: async () => "prompt", getUserMedia: async () => { calls++; return stream(); } });
    expect(r).toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(stopped).toBe(1);
  });
  test("granted starts", async () => {
    expect(await probeMic({ isSecureContext: true, query: async () => "granted", getUserMedia: async () => stream() })).toEqual({ ok: true });
  });
  test("denied never calls getUserMedia", async () => {
    let calls = 0;
    const r = await probeMic({ isSecureContext: true, query: async () => "denied", getUserMedia: async () => { calls++; return stream(); } });
    expect(r).toEqual({ ok: false, problem: "denied" });
    expect(calls).toBe(0);
  });
  test("unsupported Permissions API still asks", async () => {
    expect(await probeMic({ isSecureContext: true, query: async () => "unknown", getUserMedia: async () => stream() })).toEqual({ ok: true });
  });
  test("no device and busy device", async () => {
    expect(await probeMic({ isSecureContext: true, query: async () => "prompt", getUserMedia: reject("NotFoundError") })).toEqual({ ok: false, problem: "not_found" });
    expect(await probeMic({ isSecureContext: true, query: async () => "prompt", getUserMedia: reject("NotReadableError") })).toEqual({ ok: false, problem: "in_use" });
  });
  test("user dismisses the prompt", async () => {
    expect(await probeMic({ isSecureContext: true, query: async () => "prompt", getUserMedia: reject("NotAllowedError") })).toEqual({ ok: false, problem: "denied" });
  });
  test("insecure origin", async () => {
    expect(await probeMic({ isSecureContext: false, getUserMedia: async () => stream() })).toEqual({ ok: false, problem: "insecure" });
  });
});

describe("helpers", () => {
  test("classify and browser", () => {
    expect(classifyMicError(new Error("x"))).toBe("error");
    expect(detectBrowser("Mozilla/5.0 Firefox/130.0")).toBe("firefox");
    expect(detectBrowser("Mozilla/5.0 (Macintosh) AppleWebKit Version/17 Safari/605")).toBe("safari");
    expect(detectBrowser("Mozilla/5.0 Chrome/130 Safari/537 Edg/130")).toBe("chrome");
  });
});
