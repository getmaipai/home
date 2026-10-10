import { createContext, useContext, useState, type FormEvent } from "react";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { useIdleTimer } from "@/shell/useIdleTimer";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";
import { api, ApiError, type SignedInPerson } from "@/lib/api";

/** INCOGNITO-07: session lock with PIN re-entry, a standalone capability
 * (the backlog item's own framing - "not Incognito-specific plumbing")
 * that any account can be configured (by an owner/admin,
 * routes/people.ts's own gate) to require after inactivity. Content
 * stays mounted and intact underneath - this only covers the screen, it
 * never signs the person out or discards anything, unlike the forced-
 * wipe idle timeout an earlier design draft proposed and Jesse rejected
 * (2026-09-25). Unlocking reuses /api/auth/verify-secret exactly as the
 * real sign-in flow does (SignInPage.tsx's own secret-entry
 * fragment, composed from the same shipped kit primitives) rather than
 * a second, parallel PIN-check implementation. */
const SessionLockedContext = createContext(false);

export function useSessionLocked() {
  return useContext(SessionLockedContext);
}

export function SessionLockGate({ person, children }: { person: SignedInPerson | null; children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const timeoutMs = (person?.sessionLockTimeoutMinutes ?? 5) * 60 * 1000;
  useIdleTimer(timeoutMs, () => setLocked(true), person?.sessionLockRequired ?? false);

  async function handleUnlock(e?: FormEvent) {
    e?.preventDefault();
    if (!person) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifySecret(person.id, secret);
      setLocked(false);
      setSecret("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  }

  usePinAutoSubmit({ secret, selected: locked, busy, onSubmit: () => void handleUnlock() });

  return (
    <SessionLockedContext.Provider value={locked}>
      {children}
      {locked && person ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
          <div className="w-full max-w-md">
            <Card>
              <CardContent>
                <div className="flex flex-col items-center gap-4">
                  <Avatar name={person.display_name} className="size-16 text-xl" />
                  <h1 className="text-lg font-semibold">{person.display_name}</h1>
                  <p className="text-sm text-muted-foreground">Locked after inactivity. Enter your PIN to continue.</p>
                  <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
                    <div className="w-full space-y-1.5">
                      <Label htmlFor="lock-secret" className="text-sm font-normal text-muted-foreground">
                        PIN or password
                      </Label>
                      <Input
                        id="lock-secret"
                        type="password"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        required
                      />
                    </div>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                    <Button type="submit" size="lg" disabled={busy}>
                      {busy ? "Unlocking…" : "Unlock"}
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </SessionLockedContext.Provider>
  );
}
