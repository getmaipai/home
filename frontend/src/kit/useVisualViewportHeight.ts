import { useEffect, useState } from "react";

/** iOS Safari never shrinks `100vh`/`100svh` for the on-screen keyboard - a
 * fixed-height shell built on those units stays full height underneath it,
 * so anything measuring that shell's `clientHeight` (assistant-ui's own
 * top-anchor scroll math among them) thinks the keyboard-covered strip at
 * the bottom is still visible. Only `window.visualViewport.height` reports
 * the height actually visible above the keyboard. Returns `undefined` when
 * the API doesn't exist (desktop browsers, `far`/TV, tests), so callers can
 * fall back to their normal CSS sizing. */
export function useVisualViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(() => window.visualViewport?.height);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}
