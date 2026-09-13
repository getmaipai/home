import { useEffect, useState } from "react";
import { useIsMobile } from "@/kit/hooks/use-mobile";

// A closed keyboard's visualViewport.height can differ from
// window.innerHeight by a fractional pixel (pinch-zoom, a mid-transition
// address-bar animation, ordinary scale rounding) with no keyboard
// involved - a bare `!==` would flip into "keyboard open" mode for those,
// snapping the shell's height/position for no real reason. A real on-screen
// keyboard reclaims tens of pixels at minimum, so a small tolerance filters
// out the sub-pixel noise without ever mistaking a genuine keyboard for one.
const KEYBOARD_HEIGHT_TOLERANCE_PX = 2;

/** iOS Safari never shrinks `100vh`/`100svh` for the on-screen keyboard - a
 * fixed-height shell built on those units stays full height underneath it,
 * so anything measuring that shell's `clientHeight` (assistant-ui's own
 * top-anchor scroll math among them) thinks the keyboard-covered strip at
 * the bottom is still visible. Only `window.visualViewport.height` reports
 * the height actually visible above the keyboard.
 *
 * Returns an object with `height` and `offsetTop` only when on a mobile
 * surface AND the keyboard is actually open (viewport.height shorter than
 * window.innerHeight by more than a sub-pixel tolerance).
 * Returns `undefined` on desktop, `far`/TV, keyboard closed, or when the API
 * doesn't exist, so callers can fall back to their normal CSS sizing. */
export function useVisualViewportHeight():
  | { height: number; offsetTop: number }
  | undefined {
  const isMobile = useIsMobile();
  const [viewport, setViewport] = useState<
    { height: number; offsetTop: number } | undefined
  >(undefined);

  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp || !isMobile) {
      setViewport(undefined);
      return;
    }

    const update = () => {
      // Only apply the override when the keyboard is actually open (height
      // shrinks by more than sub-pixel noise).
      const keyboardOpen =
        vp.height !== undefined &&
        window.innerHeight - vp.height > KEYBOARD_HEIGHT_TOLERANCE_PX;
      setViewport((prev) => {
        if (!keyboardOpen) return prev === undefined ? prev : undefined;
        const offsetTop = vp.offsetTop ?? 0;
        // Skip the state update (and the re-render it would cause in every
        // consumer) when nothing actually changed - visualViewport's own
        // `scroll` event fires repeatedly during momentum scrolling even
        // while height and offsetTop stay perfectly stable.
        if (prev && prev.height === vp.height && prev.offsetTop === offsetTop) return prev;
        return { height: vp.height, offsetTop };
      });
    };

    update();
    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
    };
  }, [isMobile]);

  return viewport;
}
