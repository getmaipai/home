import { describe, expect, test, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewportHeight } from "@/kit/useVisualViewportHeight";
import { stubMatchMedia } from "../../tests/stubMatchMedia";

// happy-dom has no `VisualViewport` implementation at all, matching every
// browser that lacks the API too (desktop Firefox/older Safari) - this
// fakes just enough of it (a height, an offsetTop, and real `EventTarget`
// listener wiring) for `resize`/`scroll` to actually reach the hook's
// handler.
function stubVisualViewport(initialHeight: number, initialOffsetTop = 0) {
  const target = new EventTarget();
  const state = { height: initialHeight, offsetTop: initialOffsetTop };
  const viewport = {
    get height() {
      return state.height;
    },
    get offsetTop() {
      return state.offsetTop;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as VisualViewport;
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  return {
    setHeight: (height: number, offsetTop = 0) => {
      state.height = height;
      state.offsetTop = offsetTop;
      target.dispatchEvent(new Event("resize"));
    },
  };
}

// `useIsMobile` (the kit's own phone/tablet cutoff, 640px) reads
// `window.matchMedia` and `window.innerWidth` directly - it only needs a
// valid MediaQueryList-shaped object to call `.addEventListener` on, and
// computes its own answer from `window.innerWidth`, so the shared stub's
// default empty match map is enough.
function stubViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  stubMatchMedia();
}

afterEach(() => {
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
});

describe("useVisualViewportHeight", () => {
  test("returns undefined when the API doesn't exist", () => {
    stubViewportWidth(390); // phone width, but no visualViewport at all
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
  });

  // Desktop: never applies the override, even if visualViewport exists and
  // reports a shrunk height (e.g. a devtools panel) - only the mobile
  // surface's on-screen keyboard should ever trigger this.
  test("returns undefined on desktop even when visualViewport is shorter than innerWidth", () => {
    stubViewportWidth(1440);
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    stubVisualViewport(700); // shorter than innerHeight, but desktop never applies it
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
  });

  // Phone, keyboard closed: visualViewport.height equals window.innerHeight,
  // so there is nothing to correct for - stay on the h-svh fallback.
  test("returns undefined on phone with the keyboard closed", () => {
    stubViewportWidth(390);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    stubVisualViewport(844);
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
  });

  // Phone, keyboard open: visualViewport.height shrinks below innerHeight -
  // report both the shrunk height and offsetTop (any address-bar shift).
  test("returns height plus offsetTop on phone with the keyboard open", () => {
    stubViewportWidth(390);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    stubVisualViewport(480, 12);
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toEqual({ height: 480, offsetTop: 12 });
  });

  test("tracks a keyboard opening and closing (a visualViewport resize)", () => {
    stubViewportWidth(390);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    const { setHeight } = stubVisualViewport(844);
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
    act(() => setHeight(500, 0));
    expect(result.current).toEqual({ height: 500, offsetTop: 0 });
    act(() => setHeight(844, 0));
    expect(result.current).toBeUndefined();
  });
});
