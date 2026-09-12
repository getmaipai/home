import { describe, expect, test, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewportHeight } from "@/kit/useVisualViewportHeight";

// happy-dom has no `VisualViewport` implementation at all, matching every
// browser that lacks the API too (desktop Firefox/older Safari) - this
// fakes just enough of it (a height plus real `EventTarget` listener
// wiring) for `resize`/`scroll` to actually reach the hook's handler.
function stubVisualViewport(initialHeight: number) {
  const target = new EventTarget();
  const state = { height: initialHeight };
  const viewport = {
    get height() {
      return state.height;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as VisualViewport;
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  return {
    setHeight: (height: number) => {
      state.height = height;
      target.dispatchEvent(new Event("resize"));
    },
  };
}

afterEach(() => {
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
});

describe("useVisualViewportHeight", () => {
  test("returns undefined when the API doesn't exist", () => {
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
  });

  test("reports the current visualViewport height", () => {
    stubVisualViewport(700);
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBe(700);
  });

  test("tracks a keyboard opening (a visualViewport resize)", () => {
    const { setHeight } = stubVisualViewport(844);
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBe(844);
    act(() => setHeight(500));
    expect(result.current).toBe(500);
  });
});
