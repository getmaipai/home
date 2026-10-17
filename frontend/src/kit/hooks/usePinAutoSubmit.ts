import { useEffect, useRef } from "react";

interface UsePinAutoSubmitOptions {
  /** The value currently in the secret/PIN field. */
  secret: string;
  /** The profile a PIN prompt is currently open for, or `null`/`undefined`
   * when no prompt is showing. Doubles as the reset key: picking a
   * different profile (or re-opening the same one) is a fresh attempt. */
  selected: unknown;
  /** Digit count of the account's PIN (`Roster.pinDigits`), or null/undefined
   * when unknown or not a PIN: then nothing auto-submits. */
  pinDigits?: number | null;
  busy: boolean;
  onSubmit: () => void;
}

/** Phone-lock-style auto-submit (Jesse, 2026-09-04): an all-digit PIN submits
 * itself the instant its last digit lands, no separate tap.
 *
 * The length is the ACCOUNT'S length, not a constant (fixed 2026-10-17, a
 * live bug on a real install): the hook used to fire at exactly 4 digits,
 * but a 6-digit passcode passes through 4 digits on the way, so every
 * sign-in fired a wrong 4-digit attempt first and burned one of the five
 * allowed failures. The hub now stores a non-secret length class beside
 * each credential (`pinDigits`, person_credentials.secret_digits) and the
 * caller passes it here. Fires only when `pinDigits` is a known positive
 * number AND the secret is all digits of exactly that length. `null`,
 * `undefined` or 0 (a password, an account not yet classified, or an older
 * hub) never auto-submits: the person uses the real submit button or
 * Enter. A failed auto-submit still counts as a failure at the hub, so
 * this must never guess.
 *
 * At most one auto-fire per distinct `secret` value per `selected` value -
 * tracked by the exact string already tried, not a plain boolean, and the
 * fire happens before the caller's `onSubmit` even runs, not just on a
 * later failure. A real bug caught live in the sign-in test, before
 * this was a shared hook: a version that only disabled itself on failure
 * kept firing forever on success, because `secret` was never cleared and
 * `busy` cycled back to `false` once the request resolved. Tracking the
 * value itself (not just "has this ever fired") is what lets a second,
 * different PIN retry automatically after a wrong first attempt.
 *
 * Callers must still put their own submit handler above every conditional
 * early `return` in the component body - this hook does not change React's
 * rules of hooks for its caller. */
export function usePinAutoSubmit({ secret, selected, pinDigits, busy, onSubmit }: UsePinAutoSubmitOptions): void {
  const lastTriedRef = useRef<string | null>(null);

  useEffect(() => {
    lastTriedRef.current = null;
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    // A cleared or shorter entry is a fresh attempt: the same wrong code typed again must submit
    // again. Reset before the busy check so it never depends on how the caller batches its updates.
    if (pinDigits && secret.length !== pinDigits) lastTriedRef.current = null;
    if (busy) return;
    if (lastTriedRef.current === secret) return;
    if (!pinDigits || pinDigits < 1) return;
    if (secret.length !== pinDigits || !/^\d+$/.test(secret)) return;
    lastTriedRef.current = secret;
    onSubmit();
    // onSubmit is intentionally excluded: callers
    // pass a fresh closure every render, and including it would fire
    // this effect (and, via lastTriedRef, do nothing) on every keystroke
    // instead of only when secret/selected/busy actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, selected, pinDigits, busy]);
}
