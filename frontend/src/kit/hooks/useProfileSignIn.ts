import { useState, type FormEvent } from "react";
import { api, ApiError, type Roster } from "@/lib/api";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";
import { usePasscodeAttempt } from "@/kit/hooks/usePasscodeAttempt";

/** The profile-tap -> secret-prompt -> verify state machine (a code
 * review, SHELL-08: selected/secret/secretError/tapError/busy plus both
 * submit handlers, kept in one hook beside `usePinAutoSubmit`). Leaves
 * the profiles fetch itself to the caller (`SignInPage.tsx`'s
 * `useQuery`+`AsyncState`). */
export function useProfileSignIn(onSignedIn: () => void) {
  const [selected, setSelected] = useState<Roster | null>(null);
  const [secret, setSecret] = useState("");
  const attemptState = usePasscodeAttempt();
  const [tapError, setTapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePinAutoSubmit({ secret, selected, pinDigits: selected?.pinDigits, busy: busy || attemptState.locked, onSubmit: () => void handleSecretSubmit() });

  async function handleSecretSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    if (attemptState.locked) return;
    setBusy(true);
    attemptState.clear();
    try {
      await api.verifySecret(selected.id, secret);
      onSignedIn();
    } catch (e) {
      // A wrong code empties the boxes so the next try starts clean.
      setSecret("");
      attemptState.fail(e, "Sign-in failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileTap(person: Roster) {
    if (person.hasSecret) {
      // A stale tapError from a PREVIOUS, unrelated failed tap (a
      // different no-secret profile) must not resurface on the picker
      // once this PIN flow ends - clear it here rather than only where
      // it's set, since this early-return path skips that entirely.
      setTapError(null);
      setSelected(person);
      return;
    }
    setBusy(true);
    setTapError(null);
    try {
      await api.select(person.id);
      onSignedIn();
    } catch (e) {
      setTapError(e instanceof ApiError ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  function backToPicker() {
    setSelected(null);
    attemptState.reset();
    setSecret("");
  }

  return { selected, secret, setSecret, secretError: attemptState.message, locked: attemptState.locked, attempt: attemptState.attempt, tapError, busy, handleSecretSubmit, handleProfileTap, backToPicker };
}
