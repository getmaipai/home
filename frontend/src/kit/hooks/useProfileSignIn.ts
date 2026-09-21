import { useState, type FormEvent } from "react";
import { api, ApiError, type Roster } from "@/lib/api";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";

/** The profile-tap -> secret-prompt -> verify state machine (a code
 * review, SHELL-08: `SignIn.tsx` and `NextSignInPage.tsx` had copied this
 * verbatim - selected/secret/secretError/tapError/busy plus both submit
 * handlers - the same class of duplication `usePinAutoSubmit` was
 * extracted to close, just one layer up). Leaves the profiles fetch
 * itself to each caller (`SignIn.tsx`'s own plain effect+`useState`,
 * `NextSignInPage.tsx`'s `useQuery`+`AsyncState`) since that part
 * genuinely differs between the two shells, not just in form. */
export function useProfileSignIn(onSignedIn: () => void) {
  const [selected, setSelected] = useState<Roster | null>(null);
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePinAutoSubmit({ secret, selected, busy, onSubmit: () => void handleSecretSubmit() });

  async function handleSecretSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    setBusy(true);
    setSecretError(null);
    try {
      await api.verifySecret(selected.id, secret);
      onSignedIn();
    } catch (e) {
      setSecretError(e instanceof ApiError ? e.message : "Sign-in failed");
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
    setSecretError(null);
    setSecret("");
  }

  return { selected, secret, setSecret, secretError, tapError, busy, handleSecretSubmit, handleProfileTap, backToPicker };
}
