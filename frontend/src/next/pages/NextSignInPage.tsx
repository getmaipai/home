import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import FullLogo from "@maipai/ui/src/dashboard/layouts/full/shared/logo/FullLogo";
import { useProfileSignIn } from "@/kit/hooks/useProfileSignIn";
import { api, ApiError, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/sign-in: SHELL-08's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - the real profile picker and secret entry
 * (`GET /api/auth/profiles`, `POST /api/auth/select`,
 * `POST /api/auth/verify-secret`), composed from the template's own auth
 * form primitives (`Card`, `Input`, `Label`, `Button`, `FullLogo` - the
 * same ones the vendored `BoxedLogin` demo shows) rather than the demo's
 * own email/password form: the template's view is the same shape as
 * every other demo (zero data-binding surface, a bare `<form>` with no
 * `onSubmit`), and MaiPai's own sign-in is a profile picker, not an
 * email field, so this mirrors `SignIn.tsx`'s own real state machine
 * (profile list -> tap a profile -> a secret prompt only when that
 * profile has one) onto the template's primitives instead. Reuses
 * `usePinAutoSubmit` (a plain hook, no UI, called inside
 * `useProfileSignIn` below) rather than reimplementing the phone-lock-
 * style 4-digit auto-submit.
 *
 * Dropped, no counterpart: the template's own social sign-in buttons,
 * "Remember this device" checkbox, "Forgot password" and "Create an
 * account" links - MaiPai has no social sign-in, no remember-me (a
 * session is a session), no self-service password reset (an owner/
 * admin resets another person's secret), and no self-service account
 * creation (profiles are created in Settings -> Household -> Users).
 *
 * A correction, not a gap: the row's own ask named "the child's PIN vs
 * an adult's password as the old page distinguishes them" -
 * `SignIn.tsx` has no such distinction; every profile gets the
 * identical `<Input type="password" placeholder="PIN or password">`,
 * and `usePinAutoSubmit`'s own 4-digit-numeric check is what quietly
 * makes a short PIN feel instant without the UI ever needing to know
 * in advance which kind of secret a given profile actually has. Built
 * against the real, single field instead of inventing a role-aware
 * switch that would diverge from it.
 *
 * The tap/select/verify state machine itself is `useProfileSignIn`
 * (a code review, SHELL-08): this page and `SignIn.tsx` had copied it
 * verbatim, the same class of duplication `usePinAutoSubmit` closed one
 * layer down - only the profiles-fetch strategy still differs (this
 * page's own `useQuery`+`AsyncState` vs. `SignIn.tsx`'s plain effect). */
export function NextSignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  useDocumentTitle("Sign in");
  const profilesQuery = useQuery<Roster[]>({ queryKey: ["auth-profiles"], queryFn: () => api.profiles() });
  const { selected, secret, setSecret, secretError, tapError, busy, handleSecretSubmit, handleProfileTap, backToPicker } =
    useProfileSignIn(onSignedIn);

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent px-4">
      <Card className="w-full max-w-md border-none p-6 shadow-lg">
        <div className="mx-auto w-fit">
          <FullLogo />
        </div>
        <CardContent className="flex flex-col gap-4 p-0 pt-4">
          <AsyncState
            data={profilesQuery.data}
            error={profilesQuery.isError}
            isFetching={profilesQuery.isFetching}
            onRetry={() => profilesQuery.refetch()}
            errorMessage={profilesQuery.error instanceof ApiError ? profilesQuery.error.message : "Could not reach the hub."}
            loadingLabel="Loading household"
          >
            {(profiles: Roster[]) =>
              // A fresh install has nobody to sign in as - /setup owns
              // first-run entirely, the same redirect SignIn.tsx's own
              // "profiles.length === 0" branch already makes.
              profiles.length === 0 ? (
                <Navigate to="/setup" replace />
              ) : selected ? (
                <form onSubmit={handleSecretSubmit} className="flex flex-col items-center gap-4">
                  <Avatar name={selected.display_name} className="size-16 text-xl" />
                  <h1 className="text-lg font-semibold">{selected.display_name}</h1>
                  <div className="w-full space-y-1.5">
                    <Label htmlFor="secret" className="text-sm font-normal text-muted-foreground">
                      PIN or password
                    </Label>
                    <Input
                      id="secret"
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      // The entire screen's content, not a field inside a
                      // larger page - SignIn.tsx's own precedent for the
                      // identical prompt.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      required
                    />
                  </div>
                  {secretError ? <p className="text-sm text-destructive">{secretError}</p> : null}
                  <Button type="submit" size="lg" className="w-full rounded-lg" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                  <Button type="button" variant="ghost" size="lg" className="w-full rounded-lg" onClick={backToPicker}>
                    Back
                  </Button>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-wrap justify-center gap-6">
                    {profiles.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleProfileTap(p)}
                        disabled={busy}
                        className="flex flex-col items-center gap-2 rounded-lg p-3 hover:bg-muted disabled:opacity-50"
                      >
                        <Avatar name={p.display_name} className="size-16 text-xl" />
                        <span className="text-base">{p.display_name}</span>
                      </button>
                    ))}
                  </div>
                  {tapError ? <p className="text-sm text-destructive">{tapError}</p> : null}
                </div>
              )
            }
          </AsyncState>
        </CardContent>
      </Card>
    </div>
  );
}
