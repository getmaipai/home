import { useEffect, useRef } from "react";

interface UsePinAutoSubmitOptions {
  /** The value currently in the secret/PIN field. */
  secret: string;
  /** The profile a PIN prompt is currently open for, or `null`/`undefined`
   * when no prompt is showing. Doubles as the reset key: picking a
   * different profile (or re-opening the same one) is a fresh attempt. */
  selected: unknown;
  busy: boolean;
  onSubmit: () => void;
}

/** Phone-lock-style auto-submit (Jesse, 2026-09-04): a 4-digit numeric PIN
 * submits itself the instant the 4th digit lands, no separate tap. Scoped
 * tightly on purpose - only fires for a value that's ALL digits at EXACTLY
 * 4 characters, so a household member with a longer PIN or a real
 * alphanumeric password is never cut off mid-entry; they just keep typing
 * and press the real submit button instead, exactly like before this
 * existed.
 *
 * At most one auto-fire per distinct `secret` value per `selected` value -
 * tracked by the exact string already tried, not a plain boolean, and the
 * fire happens before the caller's `onSubmit` even runs, not just on a
 * later failure. A real bug caught live in SignIn.tsx's own test, before
 * this was a shared hook: a version that only disabled itself on failure
 * kept firing forever on success, because `secret` was never cleared and
 * `busy` cycled back to `false` once the request resolved - normally
 * hidden because signing in unmounts the caller almost immediately, which
 * is exactly the kind of "works by accident" fragility worth closing here
 * once, for every caller, rather than per copy. Tracking the value itself
 * (not just "has this ever fired") is what lets a second, different
 * 4-digit PIN retry automatically after a wrong first attempt - a plain
 * boolean flip, caught by a later code review, would permanently disable
 * auto-submit for the rest of that `selected` value's lifetime the moment
 * one wrong PIN was tried, silently downgrading every retry to a manual
 * tap with no visible explanation.
 *
 * Extracted from SignIn.tsx and ProfileSwitcher.tsx (docs/plans/wave-2.md
 * step 0 leftover: ProfileSwitcher's own header called this shared hook a
 * "real follow-up... not done here" when it duplicated the logic in small
 * form rather than risk a refactor under a session's time budget). Callers
 * must still put their own submit handler above every conditional early
 * `return` in the component body - this hook does not change React's
 * rules of hooks for its caller. */
export function usePinAutoSubmit({ secret, selected, busy, onSubmit }: UsePinAutoSubmitOptions): void {
  const lastTriedRef = useRef<string | null>(null);

  useEffect(() => {
    lastTriedRef.current = null;
  }, [selected]);

  useEffect(() => {
    if (!selected || busy) return;
    if (lastTriedRef.current === secret) return;
    if (!/^\d{4}$/.test(secret)) return;
    lastTriedRef.current = secret;
    onSubmit();
    // onSubmit is intentionally excluded: SignIn.tsx and ProfileSwitcher.tsx
    // both pass a fresh closure every render, and including it would fire
    // this effect (and, via lastTriedRef, do nothing) on every keystroke
    // instead of only when secret/selected/busy actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, selected, busy]);
}
