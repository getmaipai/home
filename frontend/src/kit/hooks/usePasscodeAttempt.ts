import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What a failed passcode attempt looks like to the person, shared by the sign-in page and the
 * session lock screen so they cannot drift: one plain error line, a `attempt` counter that the
 * caller uses as the passcode boxes' React key (a wrong code remounts them empty, with focus on
 * the first box and the red shake), and a lockout (the hub's 429 with `retryAfter`) that disables
 * the boxes and counts down until the person can try again. */
export function usePasscodeAttempt() {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setAttempt((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const lockSeconds = lockedUntil === null ? 0 : Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = lockSeconds > 0;

  /** Record a failed attempt and return true when the hub judged the code (wrong, or locked out), so
   * the caller empties the boxes. A network or server error returns false: the typed code stays,
   * nothing shakes, and the line says what to do. `what` names the credential in the wrong-code
   * line ("passcode", "password", "PIN or password"). */
  function fail(e: unknown, fallback: string, what = "passcode"): boolean {
    if (e instanceof ApiError && e.status === 429) {
      const t = Date.now();
      setNow(t);
      setLockedUntil(t + (e.retryAfter ?? 60) * 1000);
      setError(null);
      setAttempt((n) => n + 1);
      return true;
    }
    if (e instanceof ApiError && e.status === 401) {
      setError(`That ${what} is not right. Try again.`);
      setAttempt((n) => n + 1);
      return true;
    }
    setError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : fallback);
    return false;
  }

  function clear() {
    setError(null);
  }

  /** Forget the error and any lockout (the person went back to the picker). */
  function reset() {
    setError(null);
    setLockedUntil(null);
  }

  /** The one line to show, or null: the lockout with its time left, else the last error. */
  const message = locked ? `Too many wrong tries. Try again in ${clock(lockSeconds)}.` : error;

  return { message, locked, attempt, fail, clear, reset };
}
