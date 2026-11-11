import { i18n } from "@lingui/core";
import { useState, type CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent } from "@maipai/ui/src/ui/card";
import { Input } from "@maipai/ui/src/ui/input";
import { PasscodeInput } from "@maipai/ui/src/ui/passcode-input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import FullLogo from "@maipai/ui/src/dashboard/layouts/full/shared/logo/FullLogo";
import { useProfileSignIn } from "@/kit/hooks/useProfileSignIn";
import { api, type Roster } from "@/lib/api";
import { errorLine, isHubUnreachable, useWhenHubBack } from "@/lib/hubReachability";
import { useTabItem } from "@/shell/tabIdentity";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

type MaskedSecretStyle = CSSProperties & { WebkitTextSecurity: "disc" };

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
 * style auto-submit.
 *
 * Dropped, no counterpart: the template's own social sign-in buttons,
 * "Remember this device" checkbox, "Forgot password" and "Create an
 * account" links - MaiPai has no social sign-in, no remember-me (a
 * session is a session), no self-service password reset (an owner/
 * admin resets another person's secret), and no self-service account
 * creation (profiles are created in Settings -> Household -> Users).
 *
 * The credential step (MOBILE-LIVE-01) sizes itself to the account: when
 * `GET /api/auth/profiles` reports `pinDigits` (the digit count of an
 * all-digit PIN, stored non-secretly beside the hash), the kit's `InputOTP`
 * shows exactly that many slots and `usePinAutoSubmit` submits only at that
 * exact length, so a 6-digit passcode is never tried at 4 digits (each wrong
 * try counts toward the five-failure lockout). When `pinDigits` is null (a
 * password, or an account not yet classified: the next successful sign-in
 * classifies it) the screen shows the password field with a Sign in button
 * and never auto-submits. A PIN account can still choose "Use a password
 * instead" and back.
 *
 * The tap/select/verify state machine itself is `useProfileSignIn`
 * (a code review, SHELL-08), kept out of this page so the profiles-fetch
 * strategy (this page's `useQuery`+`AsyncState`) stays the page's own. */
export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  useTabItem("Sign in");
  const profilesQuery = useQuery<Roster[]>({ queryKey: ["auth-profiles"], queryFn: () => api.profiles() });
  // The hub restarting or updating: ask again by itself as soon as it answers.
  useWhenHubBack(profilesQuery.isError && isHubUnreachable(profilesQuery.error), () => { void profilesQuery.refetch(); });
  const [wantsPassword, setUsePassword] = useState(false);
  const { selected, secret, setSecret, pendingToken, totpCode, setTotpCode, secretError, locked, attempt, tapError, busy, handleSecretSubmit, handleTotpSubmit, handleProfileTap, backToPicker } =
    useProfileSignIn(onSignedIn);

  // pinDigits null/absent: length unknown or a password, so no keypad.
  const pinDigits = selected?.pinDigits && selected.pinDigits >= 1 ? selected.pinDigits : null;
  const passcodeDigits = wantsPassword ? null : pinDigits;
  const usePassword = passcodeDigits === null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
      <Card surface="flat">
        <div className="mx-auto w-fit">
          <FullLogo full />
        </div>
        <CardContent>
          <div className="flex flex-col gap-4">
          <AsyncState
            data={profilesQuery.data}
            error={profilesQuery.isError}
            isFetching={profilesQuery.isFetching}
            onRetry={() => profilesQuery.refetch()}
            errorMessage={errorLine(profilesQuery.error)}
            loadingLabel={i18n._({ id: "Loading household", message: "Loading household" })}
          >
            {(profiles: Roster[]) =>
              // A fresh install has nobody to sign in as - /setup owns
              // first-run entirely, the same redirect SignIn.tsx's own
              // "profiles.length === 0" branch already makes.
              profiles.length === 0 ? (
                <Navigate to="/setup" replace />
              ) : selected ? (
                <form onSubmit={pendingToken ? handleTotpSubmit : handleSecretSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col items-center gap-4">
                    <Avatar name={selected.display_name} className="size-16 text-row" />
                    <h1 className="text-title">{selected.display_name}</h1>
                  </div>
                  {pendingToken ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="totp-code">{i18n._({ id: "Enter your 6-digit code", message: "Enter your 6-digit code" })}</Label>
                      <Input id="totp-code" shape="pill" fill="surface" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} required />
                    </div>
                  ) : passcodeDigits === null ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="secret" className="text-supporting font-normal text-muted-foreground">
                        {i18n._({ id: "Password", message: "Password" })}</Label>
                      <Input
                        key={attempt}
                        id="secret"
                        name="maipai-secret"
                        type="text"
                        shape="pill"
                        fill="surface"
                        // eslint-disable-next-line shadcn/no-inline-styles -- WebkitTextSecurity preserves the masked appearance of this text input.
                        style={{ WebkitTextSecurity: "disc" } as MaskedSecretStyle}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                        data-bwignore
                        data-form-type="other"
                        disabled={locked}
                        aria-invalid={Boolean(secretError) && secret === "" ? true : undefined}
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
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-sm text-muted-foreground">{i18n._({ id: "Enter your {digits}-digit passcode", message: "Enter your {digits}-digit passcode", values: { digits: passcodeDigits } })}</p>
                      {/* key={attempt}: a wrong code remounts the boxes empty, focus on the first box, red with a shake. */}
                      <PasscodeInput
                        key={attempt}
                        id="secret"
                        digits={passcodeDigits}
                        value={secret}
                        onChange={setSecret}
                        invalid={Boolean(secretError) && secret === ""}
                        disabled={busy || locked}
                        // The whole screen is this one question.
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      />
                    </div>
                  )}
                  {secretError ? <Alert variant="destructive"><AlertDescription>{secretError}</AlertDescription></Alert> : null}
                  {secretError && !pendingToken && !usePassword && !locked ? (
                    <p className="text-center text-sm text-muted-foreground">{i18n._({ id: "Using a password? Tap \"Use a password instead\".", message: "Using a password? Tap \"Use a password instead\"." })}</p>
                  ) : null}
                  {pendingToken || usePassword ? (
                    <Button type="submit" size="lg" disabled={busy || locked}>
                      {busy ? i18n._({ id: "Signing in…", message: "Signing in…" }) : pendingToken ? i18n._({ id: "Continue", message: "Continue" }) : i18n._({ id: "Sign in", message: "Sign in" })}
                    </Button>
                  ) : null}
                  {!pendingToken && pinDigits !== null ? (
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        setUsePassword(!wantsPassword);
                        setSecret("");
                      }}
                    >
                      {usePassword ? i18n._({ id: "Use a PIN instead", message: "Use a PIN instead" }) : i18n._({ id: "Use a password instead", message: "Use a password instead" })}
                    </Button>
                  ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                      setUsePassword(false);
                      backToPicker();
                    }}
                  >
                    {i18n._({ id: "Back", message: "Back" })}</Button>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-wrap justify-center gap-6">
                    {profiles.map((p) => (
                      <Button
                        key={p.id}
                        type="button"
                        onClick={() => handleProfileTap(p)}
                        disabled={busy}
                        variant="ghost"
                        shape="pill"
                        size="control"
                      >
                        <Avatar name={p.display_name} className="size-16 text-row" />
                        <span className="text-row">{p.display_name}</span>
                      </Button>
                    ))}
                  </div>
                  {tapError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={tapError} /> : null}
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
