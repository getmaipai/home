import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useClipPreview } from "@/shell/pages/companionFlow/useClipPreview";

const urls = { h264: "/clip.mp4", av1: "/clip-av1.mp4" } as never;
const realMatch = window.matchMedia;
afterEach(() => { cleanup(); window.matchMedia = realMatch; });

function motion(reduce: boolean) {
  window.matchMedia = (() => ({ matches: reduce, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
}

test("uses the H.264 clip when the browser does not say it can play AV1", () => {
  motion(false);
  const { result } = renderHook(() => useClipPreview(urls, "Idle"));
  expect(result.current.source).toBe("/clip.mp4");
  expect(result.current.reduced).toBe(false);
});

test("reduced motion holds the clip until the person asks to play it, and an error is remembered", () => {
  motion(true);
  const { result } = renderHook(() => useClipPreview(urls, "Idle"));
  expect(result.current.reduced).toBe(true);
  act(() => result.current.play());
  expect(result.current.reduced).toBe(false);
  act(() => result.current.onError());
  expect(result.current.failed).toBe(true);
});
