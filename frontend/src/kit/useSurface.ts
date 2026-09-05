import { useEffect, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

export type PointerType = "fine" | "coarse";
export type InputMode = "touch" | "pointer" | "keyboard" | "remote";

export interface SurfaceState {
  pointer: PointerType;
  hover: boolean;
  input: InputMode;
  /** The TV surface (docs/UI.md: defined by input mode, not width). */
  far: boolean;
}

// webOS (LG), Tizen (Samsung) and the two common Fire TV/Google TV user
// agent tokens - the real TV browsers this product actually has to run
// on, not a guess. Nothing on npm detects a remote directly (the
// framework table's own note); a TV's arrow keys arrive as plain
// `keydown` identical to a keyboard's, so this is the one signal that
// tells the two apart.
const TV_USER_AGENT = /Web0S|Tizen|SmartTV|GoogleTV|AFTB|AFTT|AFTS/i;

function detectFar(): boolean {
  if (typeof navigator === "undefined") return false;
  return TV_USER_AGENT.test(navigator.userAgent);
}

/** Media queries report what a device is *capable of*; a laptop with a
 * touchscreen is still `hover: hover` and `pointer: fine` most of the
 * time, and a desktop with a graphics tablet can be `pointer: coarse`.
 * `input` is what the last real interaction actually was, which is the
 * thing every responsive decision in the kit needs (docs/BACKLOG.md:
 * "media queries report capability, events report what is in use; the
 * hook needs both"). No component reads `window` or a media query
 * directly - this is the one place that happens. */
export function useSurface(): SurfaceState {
  const coarse = useMediaQuery("(pointer: coarse)");
  const hover = useMediaQuery("(hover: hover)");
  const [far, setFar] = useState(detectFar);
  const [input, setInput] = useState<InputMode>(() => (coarse ? "touch" : "pointer"));

  useEffect(() => {
    function onKeyDown() {
      setInput((far ? "remote" : "keyboard") as InputMode);
    }
    function onPointerDown(e: PointerEvent) {
      setInput(e.pointerType === "touch" ? "touch" : "pointer");
    }
    function onGamepadConnected() {
      setFar(true);
      setInput("remote");
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("gamepadconnected", onGamepadConnected);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("gamepadconnected", onGamepadConnected);
    };
  }, [far]);

  return { pointer: coarse ? "coarse" : "fine", hover, input, far };
}
