import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { micHelp, micFixSteps, useMicGate } from "@/lib/media/micGate";

afterEach(cleanup);
beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
const SAFARI = "Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/27.0 Safari/605";
const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537 Chrome/140 Safari/537";
const stream = { getTracks: () => [] } as unknown as MediaStream;

describe("useMicGate", () => {
  test("two taps while one is pending make one request", async () => {
    let calls = 0;
    let release!: () => void;
    const gum = () => { calls++; return new Promise<MediaStream>((r) => { release = () => r(stream); }); };
    const onGranted = mock(() => {});
    const { result } = renderHook(() => useMicGate(onGranted, { isSecureContext: true, query: async () => "prompt", getUserMedia: gum }));
    await act(async () => { void result.current.request(); void result.current.request(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls).toBe(1);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
  test("denied shows the problem and does not start", async () => {
    const onGranted = mock(() => {});
    const { result } = renderHook(() => useMicGate(onGranted, { isSecureContext: true, query: async () => "denied", getUserMedia: async () => stream }));
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBe("denied");
    expect(onGranted).not.toHaveBeenCalled();
  });
});

describe("useMicGate.diagnose (regression: open/close loop on a capture failure)", () => {
  test("a passing probe never opens the session again, and reports ok once", async () => {
    const onGranted = mock(() => {});
    const { result } = renderHook(() => useMicGate(onGranted, { isSecureContext: true, query: async () => "granted", getUserMedia: async () => stream }));
    let ok: unknown;
    await act(async () => { ok = await result.current.diagnose(); });
    expect(ok).toBeTruthy();
    expect(onGranted).not.toHaveBeenCalled();
  });
  test("a blocked mic still shows the help and returns nothing", async () => {
    const onGranted = mock(() => {});
    const { result } = renderHook(() => useMicGate(onGranted, { isSecureContext: true, query: async () => "denied", getUserMedia: async () => stream }));
    let ok: unknown = "unset";
    await act(async () => { ok = await result.current.diagnose(); });
    expect(ok).toBeUndefined();
    expect(result.current.problem).toBe("denied");
  });
});

describe("Safari ask-every-time tip", () => {
  const gate = (state: "prompt" | "granted", userAgent: string, onGranted = mock(() => {})) =>
    renderHook(() => useMicGate(onGranted, { isSecureContext: true, userAgent, query: async () => state, getUserMedia: async () => stream, graceMs: 0 }));
  test("Safari on prompt shows the tip once per session, then carries on", async () => {
    const onGranted = mock(() => {});
    const { result } = gate("prompt", SAFARI, onGranted);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBe("safari_ask");
    expect(onGranted).not.toHaveBeenCalled();
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBeNull();
    expect(onGranted).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBeNull(); // not shown a second time
    expect(onGranted).toHaveBeenCalledTimes(2);
  });
  test("Safari already on Allow shows nothing", async () => {
    const onGranted = mock(() => {});
    const { result } = gate("granted", SAFARI, onGranted);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBeNull();
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
  test("Chrome on prompt shows nothing", async () => {
    const { result } = gate("prompt", CHROME);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.request(); });
    expect(result.current.problem).toBeNull();
  });
  test("the help copy names both Safari routes", () => {
    const help = micHelp("safari_ask");
    expect(help.cause).toMatch(/Settings > Websites > Microphone/);
    expect(help.steps.join(" ")).toMatch(/Settings for this site/);
  });
});

describe("micHelp", () => {
  test("denied on Safari lists the Safari path and the macOS layer", () => {
    const help = micHelp("denied", "Version/17 Safari/605");
    expect(help.title).toBe("Microphone is blocked");
    expect(help.steps.join(" ")).toMatch(/Settings for This Website/);
    expect(help.steps.join(" ")).toMatch(/Privacy & Security/);
  });
  test("no microphone and busy get their own line, no steps", () => {
    expect(micHelp("not_found").title).toBe("No microphone found");
    expect(micHelp("in_use").cause).toMatch(/Another app/);
    expect(micHelp("not_found").cause).toMatch(/no microphone/);
    expect(micHelp("not_found", "Mozilla/5.0 Version/27 Safari/605").steps.join(" ")).toMatch(/Sound > Input/);
  });
  test("chrome steps", () => expect(micFixSteps("chrome")[0]).toMatch(/address bar/));
});
