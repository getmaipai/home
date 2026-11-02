// RADIO-LOADING-01: whether a media element is waiting for sound (connecting before it first plays, or buffering after a stall), and
// whether a live stream that never started should be called failed. The mini bar shows the state; nothing here stores anything.
import { useEffect, useRef, useState } from "react";

/** How long a stream may stay silent after Play before the bar says it did not start. */
export const START_GIVE_UP_MS = 15_000;
const HAVE_FUTURE_DATA = 3;
const NETWORK_LOADING = 2;

/** True while the person wants sound and the element has not got enough of it yet. `userPaused` is the person's own Pause. */
export function isWaitingForSound(el: HTMLMediaElement, userPaused: boolean): boolean {
  if (el.error || el.ended || userPaused) return false;
  if (!el.hasAttribute("src") && !el.currentSrc) return false;
  if (el.readyState >= HAVE_FUTURE_DATA) return false;
  // A pending autoplay keeps `paused` true until enough data arrives, so a loading element that will autoplay counts as wanted.
  return !el.paused || (el.autoplay && el.networkState === NETWORK_LOADING);
}

export interface MediaLoading {
  /** Waiting for sound and not yet given up. */
  loading: boolean;
  /** "connecting" until the element first plays, "buffering" after that. */
  phase: "connecting" | "buffering";
  /** Silent for START_GIVE_UP_MS in a row (only when `giveUpMs` is set). */
  failed: boolean;
}

const EVENTS = ["loadstart", "waiting", "stalled", "playing", "canplay", "canplaythrough", "play", "pause", "emptied", "error", "ended", "suspend", "abort"] as const;

export function useMediaLoading(el: HTMLMediaElement | null, giveUpMs: number | null = null): MediaLoading {
  const [state, setState] = useState<MediaLoading>({ loading: false, phase: "connecting", failed: false });
  const userPaused = useRef(false);
  const sawPlaying = useRef(false);
  useEffect(() => {
    userPaused.current = false;
    sawPlaying.current = false;
    if (!el) { setState({ loading: false, phase: "connecting", failed: false }); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failed = false;
    const stop = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    const sync = () => {
      // A live stream that errors is being retried (liveReconnect.ts), so it counts as waiting; the give-up timer then calls it failed.
      const errored = giveUpMs !== null && el.error !== null && !userPaused.current;
      const waiting = errored || isWaitingForSound(el, userPaused.current);
      if (!waiting) { stop(); failed = false; } else if (giveUpMs !== null && timer === null && !failed) {
        timer = setTimeout(() => { timer = null; failed = true; sync(); }, giveUpMs);
      }
      const next: MediaLoading = { loading: waiting && !failed, phase: sawPlaying.current ? "buffering" : "connecting", failed: waiting && failed };
      setState((old) => (old.loading === next.loading && old.phase === next.phase && old.failed === next.failed ? old : next));
    };
    const on = (name: string) => {
      if (name === "playing") sawPlaying.current = true;
      // A pause that is not the stream failing is the person's own; their next Play (or a reload) clears it.
      if (name === "pause") userPaused.current = !el.ended && !el.error;
      if (name === "play" || name === "loadstart") userPaused.current = false;
      if (name === "loadstart" || name === "playing") { stop(); failed = false; }
      sync();
    };
    const handlers = EVENTS.map((name) => [name, () => on(name)] as const);
    for (const [name, fn] of handlers) el.addEventListener(name, fn);
    sync();
    return () => { stop(); for (const [name, fn] of handlers) el.removeEventListener(name, fn); };
  }, [el, giveUpMs]);
  return state;
}
