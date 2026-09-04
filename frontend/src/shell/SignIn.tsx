import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Roster } from "@/lib/api";
import { Button } from "@/kit/components/Button";
import { Input } from "@/kit/components/Input";
import { Avatar } from "@/kit/components/Avatar";
import { Progress } from "@/kit/primitives/Progress";

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
  const [displayName, setDisplayName] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A PIN-style auto-submit that came back wrong must not keep re-firing
  // on every later keystroke - see the auto-submit effect below for why.
  // Reset whenever a different profile is selected (a fresh attempt).
  const autoSubmitDisabledRef = useRef(false);
  useEffect(() => {
    autoSubmitDisabledRef.current = false;
  }, [selected]);

  useEffect(() => {
    api
      .profiles()
      .then(setProfiles)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not reach the hub"));
  }, []);

  // Phone-lock-style auto-submit (Jesse, 2026-09-04): a 4-digit numeric
  // PIN submits itself the instant the 4th digit lands, no separate tap.
  // Scoped tightly on purpose - only fires for a value that's ALL digits
  // at EXACTLY 4 characters, so a household member with a longer PIN or a
  // real alphanumeric password is never cut off mid-entry; they just keep
  // typing and press Sign in as before, exactly like today. Must live up
  // here with the other hooks, above every conditional `return` below -
  // React's rules of hooks, not just style (a first pass that put this
  // after the early returns crashed with "Rendered more hooks than
  // during the previous render" the moment profiles finished loading).
  //
  // At most one auto-fire per selected profile, full stop - the ref flips
  // the instant this decides to fire, before the request even goes out,
  // not just on a later failure. A real bug caught live in this file's own
  // test: on SUCCESS, `secret` is never cleared and `busy` cycles back to
  // false once the request resolves, so a version that only disabled
  // itself on failure re-ran this effect and fired again, forever, in an
  // infinite loop - normally hidden because a real app's onSignedIn()
  // unmounts this component almost immediately, which is exactly the kind
  // of "works by accident, breaks the moment that assumption changes"
  // fragility worth closing here instead of relying on.
  useEffect(() => {
    if (!selected || busy) return;
    if (autoSubmitDisabledRef.current) return;
    if (!/^\d{4}$/.test(secret)) return;
    autoSubmitDisabledRef.current = true;
    void handleSecretSubmit();
  }, [secret, selected, busy]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-[hsl(var(--destructive))]">
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

  async function handleSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup(displayName, newSecret);
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSecretSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifySecret(selected.id, secret);
      onSignedIn();
    } catch (e) {
      // Whether this call came from the auto-submit effect (which already
      // flipped autoSubmitDisabledRef before calling this) or a manual
      // Sign-in click, a wrong PIN just shows the error - manual Sign-in
      // keeps working normally either way, same as before this feature
      // existed.
      setError(e instanceof ApiError ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileTap(person: Roster) {
    if (person.hasSecret) {
      setSelected(person);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.select(person.id);
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (profiles.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <form onSubmit={handleSetup} className="flex w-full max-w-sm flex-col gap-4">
          <img src="/brand/maipai-home-logo-light.png" alt="MaiPai Home" className="mx-auto h-10 w-auto brand-logo-light" />
          <img src="/brand/maipai-home-logo-dark.png" alt="MaiPai Home" className="mx-auto h-10 w-auto brand-logo-dark" />
          <h1 className="text-center text-lg font-semibold">Welcome. Let's set up your household.</h1>
          <Input placeholder="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <Input
            type="password"
            placeholder="Choose a PIN or password"
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Setting up…" : "Get started"}
          </Button>
        </form>
      </div>
    );
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
            autoFocus
            required
          />
          {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setSelected(null); setError(null); setSecret(""); }}>
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
            onClick={() => handleProfileTap(p)}
            disabled={busy}
            className="flex flex-col items-center gap-2 rounded-[var(--radius)] p-3 hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            <Avatar name={p.display_name} className="h-16 w-16 text-xl" />
            <span className="text-base">{p.display_name}</span>
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
    </div>
  );
}
