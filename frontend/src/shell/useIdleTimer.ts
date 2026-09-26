import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Fires `onIdle` once the user has gone `timeoutMs` without any of
 * ACTIVITY_EVENTS, and keeps re-arming on every activity tick after that -
 * INCOGNITO-07's session lock is the one caller (the idle clock behind
 * "locks after inactivity"). `enabled: false` tears the listeners down
 * entirely rather than just skipping the callback, so a person whose
 * account doesn't require a lock pays nothing for this being mounted. */
export function useIdleTimer(timeoutMs: number, onIdle: () => void, enabled: boolean): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs);
    }

    reset();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [timeoutMs, enabled]);
}
