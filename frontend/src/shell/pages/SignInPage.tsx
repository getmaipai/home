import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@maipai/ui/src/dashboard/components/ui/input-otp";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import FullLogo from "@maipai/ui/src/dashboard/layouts/full/shared/logo/FullLogo";
import { useProfileSignIn } from "@/kit/hooks/useProfileSignIn";
import { api, ApiError, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /sign-in: SHELL-08's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - the real profile picker and secret entry
 * (`GET /api/auth/profiles`, `POST /api/auth/select`,
 * `POST /api/auth/verify-secret`), composed from the template's own auth
 * form primitives (`Card`, `Input`, `Label`, `Button`, `FullLogo` - the
 * same ones the vendored `BoxedLogin` demo shows) rather than the demo's
 * own email/password form: the template's view is the same shape as
 * every other demo (zero data-binding surface, a bare `<form>` with no
 * `onSubmit`), and MaiPai's own sign-in is a profile picker, not an
 * email field, so this mirrors the real state machine
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
 * The credential step (MOBILE-LIVE-01) is a four-slot numeric PIN entry
 * (the kit's `InputOTP`: the phone's numeric keypad, one slot per digit),
 * not a text box. The hub stores no record of whether a credential is a PIN
 * or a password (`GET /api/auth/profiles` only says `hasSecret`), and a
 * credential may be 4 to 128 characters of anything, so nobody is locked
 * out: an explicit "Use a password instead" link swaps the keypad for the
 * text field, and "Use a PIN instead" swaps back. `usePinAutoSubmit` still
 * submits the instant a fourth digit lands.
 *
 * The tap/select/verify state machine itself is `useProfileSignIn`
 * (a code review, SHELL-08), kept out of this page so the profiles-fetch
 * strategy (this page's `useQuery`+`AsyncState`) stays the page's own. */
export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  useTabItem("Sign in");
  const profilesQuery = useQuery<Roster[]>({ queryKey: ["auth-profiles"], queryFn: () => api.profiles() });
  const [usePassword, setUsePassword] = useState(false);
  const { selected, secret, setSecret, secretError, tapError, busy, handleSecretSubmit, handleProfileTap, backToPicker } =
    useProfileSignIn(onSignedIn);

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent px-4">
      <div className="w-full max-w-md">
      <Card>
        <div className="mx-auto w-fit">
          <FullLogo />
        </div>
        <CardContent>
          <div className="flex flex-col gap-4">
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
                <form onSubmit={handleSecretSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col items-center gap-4">
                    <Avatar name={selected.display_name} className="size-16 text-xl" />
                    <h1 className="text-lg font-semibold">{selected.display_name}</h1>
                  </div>
                  {usePassword ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="secret" className="text-sm font-normal text-muted-foreground">
                        Password
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
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      <Label htmlFor="secret" className="text-sm font-normal text-muted-foreground">
                        Enter your PIN
                      </Label>
                      <InputOTP
                        id="secret"
                        maxLength={4}
                        inputMode="numeric"
                        pattern="^[0-9]*$"
                        value={secret}
                        onChange={setSecret}
                        disabled={busy}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      >
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  )}
                  {secretError ? <p className="text-sm text-destructive">{secretError}</p> : null}
                  {secretError && !usePassword ? (
                    <p className="text-sm text-muted-foreground">
                      Sign in with a password longer than 4 characters? Tap "Use a password instead".
                    </p>
                  ) : null}
                  {usePassword ? (
                    <Button type="submit" size="lg" disabled={busy}>
                      {busy ? "Signing in…" : "Sign in"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      setUsePassword(!usePassword);
                      setSecret("");
                    }}
                  >
                    {usePassword ? "Use a PIN instead" : "Use a password instead"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={() => {
                      setUsePassword(false);
                      backToPicker();
                    }}
                  >
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
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
