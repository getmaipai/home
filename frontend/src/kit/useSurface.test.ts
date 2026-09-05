import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useSurface } from "@/kit/useSurface";

// happy-dom's `matchMedia` does not evaluate `pointer`/`hover` media
// features, so this stubs `window.matchMedia` directly rather than
// relying on real CSS evaluation - the same reason `usehooks-ts`'s own
// implementation only ever calls `.matches`/`.addEventListener` on
// whatever `matchMedia` returns, never the query string itself.
function stubMatchMedia(matches: Record<string, boolean>) {
  window.matchMedia = ((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
}

const originalUserAgent = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe("useSurface", () => {
  beforeEach(() => {
    stubMatchMedia({ "(pointer: coarse)": false, "(hover: hover)": true });
    setUserAgent("Mozilla/5.0 (Macintosh)");
  });

  test("reports capability from media queries", () => {
    const { result } = renderHook(() => useSurface());
    expect(result.current.pointer).toBe("fine");
    expect(result.current.hover).toBe(true);
    expect(result.current.far).toBe(false);
  });

  test("touch capability starts input at touch", () => {
    stubMatchMedia({ "(pointer: coarse)": true, "(hover: hover)": false });
    const { result } = renderHook(() => useSurface());
    expect(result.current.pointer).toBe("coarse");
    expect(result.current.input).toBe("touch");
  });

  test("a keydown switches input to keyboard", () => {
    const { result } = renderHook(() => useSurface());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(result.current.input).toBe("keyboard");
  });

  test("a pointerdown with pointerType touch switches input to touch", () => {
    const { result } = renderHook(() => useSurface());
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch" }));
    });
    expect(result.current.input).toBe("touch");
  });

  test("a webOS/Tizen user agent reports the TV surface", () => {
    setUserAgent("Mozilla/5.0 (Web0S; Linux/SmartTV)");
    const { result } = renderHook(() => useSurface());
    expect(result.current.far).toBe(true);
  });

  test("on a TV, a keydown reports input as remote, not keyboard", () => {
    setUserAgent("Mozilla/5.0 (Web0S; Linux/SmartTV)");
    const { result } = renderHook(() => useSurface());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(result.current.input).toBe("remote");
  });

  test("a gamepad connecting sets far and remote even without a TV user agent", () => {
    const { result } = renderHook(() => useSurface());
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });
    expect(result.current.far).toBe(true);
    expect(result.current.input).toBe("remote");
  });
});
