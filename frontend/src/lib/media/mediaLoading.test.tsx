import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { isWaitingForSound, useMediaLoading } from "./mediaLoading";

afterEach(cleanup);

function audio(over: Partial<{ paused: boolean; readyState: number; networkState: number; autoplay: boolean }> = {}) {
  const el = document.createElement("audio");
  el.setAttribute("src", "/api/plugins/music/radio/stream/source-abc123");
  const values = { paused: true, readyState: 0, networkState: 2, autoplay: true, ...over };
  for (const key of ["paused", "readyState", "networkState"] as const) Object.defineProperty(el, key, { configurable: true, get: () => values[key] });
  el.autoplay = values.autoplay;
  return { el, values };
}

describe("isWaitingForSound", () => {
  test("is true from the moment Play is requested until enough sound has arrived", () => {
    const { el, values } = audio({ paused: false });
    expect(isWaitingForSound(el, false)).toBe(true);
    values.readyState = 4;
    expect(isWaitingForSound(el, false)).toBe(false);
  });
  test("counts a pending autoplay, but not the person's own Pause or a blocked autoplay", () => {
    const { el, values } = audio();
    expect(isWaitingForSound(el, false)).toBe(true);
    expect(isWaitingForSound(el, true)).toBe(false);
    values.networkState = 1;
    expect(isWaitingForSound(el, false)).toBe(false);
  });
  test("is false for a closed element with no source", () => {
    const { el } = audio({ paused: false });
    el.removeAttribute("src");
    expect(isWaitingForSound(el, false)).toBe(false);
  });
});

describe("useMediaLoading", () => {
  test("shows connecting, then nothing once playing, then buffering on a stall", () => {
    const { el, values } = audio({ paused: false });
    const { result } = renderHook(() => useMediaLoading(el));
    expect(result.current).toMatchObject({ loading: true, phase: "connecting" });
    act(() => { values.readyState = 4; el.dispatchEvent(new Event("playing")); });
    expect(result.current.loading).toBe(false);
    act(() => { values.readyState = 1; el.dispatchEvent(new Event("waiting")); });
    expect(result.current).toMatchObject({ loading: true, phase: "buffering" });
  });
  test("says failed after the give-up time, and a reload clears it", async () => {
    const { el } = audio({ paused: false });
    const { result } = renderHook(() => useMediaLoading(el, 30));
    expect(result.current.failed).toBe(false);
    await act(async () => { await new Promise((done) => setTimeout(done, 60)); });
    expect(result.current).toMatchObject({ failed: true, loading: false });
    act(() => { el.dispatchEvent(new Event("loadstart")); });
    expect(result.current).toMatchObject({ failed: false, loading: true });
  });
  test("a person's Pause stops the indicator", () => {
    const { el, values } = audio({ paused: false });
    const { result } = renderHook(() => useMediaLoading(el));
    act(() => { values.paused = true; el.dispatchEvent(new Event("pause")); });
    expect(result.current.loading).toBe(false);
  });
});

describe("a stream that errors", () => {
  test("is failed for a live stream once the give-up time passes, not silent", async () => {
    const { el } = audio({ paused: false });
    Object.defineProperty(el, "error", { configurable: true, get: () => ({ code: 4 }) });
    const { result } = renderHook(() => useMediaLoading(el, 30));
    expect(result.current).toMatchObject({ failed: false, loading: true });
    await act(async () => { await new Promise((done) => setTimeout(done, 60)); });
    expect(result.current).toMatchObject({ failed: true, loading: false });
  });
});
