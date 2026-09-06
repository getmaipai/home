import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError, type Roster } from "@/lib/api";
import { Button } from "@/kit/ui/button";
import { Input } from "@/kit/ui/input";
import { Avatar } from "@/kit/primitives/Avatar";
import { Progress } from "@/kit/primitives/Progress";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";
import { cn, FOCUS_RING } from "@/kit/utils";

interface SignInProps {
  onSignedIn: () => void;
}

// 4.1's profile picker + first-run owner setup, hand-built (not yet a
// declared UiNode page - v0 of spec/ui only covers Chat, docs/dev.md).
// Precedes the shell chrome entirely: nothing in chapter 6 renders before
// someone is signed in.
export function SignIn({ onSignedIn }: SignInProps) {
  const [profiles, setProfiles] = useState<Roster[] | null>(null);
  const [selected, setSelected] = useState<Roster | null>(null);
  const [secret, setSecret] = useState("");
  // `error` is reserved for the profile-fetch failure below (there's no
  // picker to show yet, so a full-screen message is the only option). A
  // wrong PIN or a failed direct tap both have a real screen behind them
  // to keep showing - issue #19 found the top-level `if (error)` early
  // return below firing for handleSecretSubmit's own catch too, nuking
  // the whole sign-in screen (profile picker, PIN pad, everything) down
  // to bare error text with no way back except a refresh. Two more
  // states, each rendered inline on the screen it belongs to, instead of
  // funneling every failure through the one state that also controls
  // whether a picker exists to render at all.
  const [error, setError] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .profiles()
      .then(setProfiles)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not reach the hub"));
  }, []);

  // Must live up here with the other hooks, above every conditional
  // `return` below - React's rules of hooks, not just style (a first pass
  // that put this after the early returns crashed with "Rendered more
  // hooks than during the previous render" the moment profiles finished
  // loading). See usePinAutoSubmit's own doc comment for what this does
  // and the infinite-loop bug it exists to close.
  usePinAutoSubmit({ secret, selected, busy, onSubmit: () => void handleSecretSubmit() });

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-[var(--destructive)]">
        {error}
      </div>
    );
  }

  if (profiles === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Progress mode="spinner" label="Loading household" />
      </div>
    );
  }

  async function handleSecretSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    setBusy(true);
    setSecretError(null);
    try {
      await api.verifySecret(selected.id, secret);
      onSignedIn();
    } catch (e) {
      // Whether this call came from the auto-submit effect (which already
      // flipped autoSubmitDisabledRef before calling this) or a manual
      // Sign-in click, a wrong PIN just shows the error inline, next to
      // the PIN field - manual Sign-in keeps working normally either
      // way, same as before this feature existed.
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

  // A fresh install has nobody signed in and nobody to sign in as: the
  // wizard (`/setup`, docs/plans/session-e-ui-and-docs.md step 1) owns
  // first-run entirely now - this used to render its own single-step
  // "name + PIN" form here, replaced by the real multi-step flow plan
  // 12 describes (language/locale, the owner's profile, the AI-outputs
  // disclaimer, hardware, trust, packages, remote access, the emergency
  // kit, backups, done).
  if (profiles.length === 0) {
    return <Navigate to="/setup" replace />;
  }

  if (selected) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <form onSubmit={handleSecretSubmit} className="flex w-full max-w-sm flex-col gap-4">
          <Avatar name={selected.display_name} className="mx-auto h-16 w-16 text-xl" />
          <h1 className="text-center text-lg font-semibold">{selected.display_name}</h1>
          <Input
            type="password"
            placeholder="PIN or password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            // This is the entire screen's content, not a field inside a
            // larger page (jsx-a11y's usual objection to autoFocus is
            // that it can silently move a screen reader's position on a
            // page with other content) - a PIN prompt with nothing else
            // to focus is the accepted exception.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            required
          />
          {secretError ? <p className="text-sm text-[var(--destructive)]">{secretError}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setSelected(null); setSecretError(null); setSecret(""); }}>
            Back
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 p-6">
      <img src="/brand/maipai-home-logo-light.png" alt="MaiPai Home" className="h-10 w-auto brand-logo-light" />
      <img src="/brand/maipai-home-logo-dark.png" alt="MaiPai Home" className="h-10 w-auto brand-logo-dark" />
      <div className="flex flex-wrap justify-center gap-6">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleProfileTap(p)}
            disabled={busy}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg p-3 hover:bg-muted disabled:opacity-50",
              FOCUS_RING,
            )}
          >
            <Avatar name={p.display_name} className="h-16 w-16 text-xl" />
            <span className="text-base">{p.display_name}</span>
          </button>
        ))}
      </div>
      {tapError ? <p className="text-sm text-[var(--destructive)]">{tapError}</p> : null}
    </div>
  );
}
