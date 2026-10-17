import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { micHelp, micFixSteps, useMicGate } from "@/lib/media/micGate";

afterEach(cleanup);
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
    expect(micHelp("not_found").steps).toEqual([]);
  });
  test("chrome steps", () => expect(micFixSteps("chrome")[0]).toMatch(/address bar/));
});
