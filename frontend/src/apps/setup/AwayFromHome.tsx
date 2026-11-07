import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { Button } from "@maipai/ui/src/ui/button";
import { QrCode } from "@maipai/ui/src/ui/qr-code";
import { api, type SignedInPerson, type TailscaleStatus } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

const steps = (): WizardStep[] => [
  { id: "device", title: i18n._({ id: "Install and sign in", message: "Install and sign in" }) },
  { id: "secure", title: i18n._({ id: "Turn on secure addresses", message: "Turn on secure addresses" }) },
  { id: "phone", title: i18n._({ id: "Scan the code", message: "Scan the code" }) },
];
type StepId = "device" | "secure" | "phone";
type RouteState = { from?: string };

function firstUnfinishedStep(status: TailscaleStatus): StepId {
  if (!status.installed || !status.signedIn) return "device";
  if (!status.httpsEnabled || !status.enabled) return "secure";
  return "phone";
}

function isOwnerOrAdmin(person: SignedInPerson | null): person is SignedInPerson {
  return person?.role === "owner" || person?.role === "admin";
}

export function AwayFromHome({ operator }: { operator: SignedInPerson | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [stepOverride, setStepOverride] = useState<StepId | null>(null);
  const [enabledAddress, setEnabledAddress] = useState<{ url: string; qrPayload: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollPending = useRef(false);

  useEffect(() => {
    if (!isOwnerOrAdmin(operator)) return;
    let active = true;
    const poll = () => {
      if (pollPending.current) return;
      pollPending.current = true;
      void api.tailscaleStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      setError(null);
    }).catch((reason) => {
      if (active) setError(i18n._({ id: "{errorLine} Check your connection and try again.", message: "{errorLine} Check your connection and try again.", values: { errorLine: errorLine(reason, "Home couldn't check Tailscale.") } }));
    }).finally(() => { pollPending.current = false; });
    };
    poll();
    const timer = window.setInterval(poll, 4000);
    const focus = () => poll();
    window.addEventListener("focus", focus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [operator]);

  function close() {
    const from = (location.state as RouteState | null)?.from;
    navigate(from?.startsWith("/") && !from.startsWith("//") && from !== "/setup/away" ? from : "/settings/advanced?tab=network");
  }

  if (!isOwnerOrAdmin(operator)) {
    return (
      <main>
        <h1>{i18n._({ id: "Set up away access", message: "Set up away access" })}</h1>
        {operator ? (
          <>
            <p>{i18n._({ id: "Only the owner or an admin can set up away access.", message: "Only the owner or an admin can set up away access." })}</p>
            <p>{i18n._({ id: "Ask one of them to finish this setup for your Home.", message: "Ask one of them to finish this setup for your Home." })}</p>
          </>
        ) : (
          <>
            <p>{i18n._({ id: "Sign in to MaiPai Home to continue.", message: "Sign in to MaiPai Home to continue." })}</p>
            <p>{i18n._({ id: "Only the owner or an admin can set up away access.", message: "Only the owner or an admin can set up away access." })}</p>
          </>
        )}
        <Button asChild variant="link"><Link to="/">{i18n._({ id: "Go to Home", message: "Go to Home" })}</Link></Button>
      </main>
    );
  }

  const currentStepId = stepOverride ?? (status ? firstUnfinishedStep(status) : "device");
  const currentIndex = steps().findIndex((step) => step.id === currentStepId);
  const readyForHomeAccess = Boolean(status?.installed && status.signedIn && status.httpsEnabled);
  const address = enabledAddress?.url ?? status?.url;
  const qrPayload = enabledAddress?.qrPayload ?? address;

  async function enableAwayAccess() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.enableTailscale();
      setEnabledAddress(result);
      setStatus((current) => current ? { ...current, enabled: true, url: result.url } : current);
      setStepOverride("phone");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : i18n._({ id: "Home couldn't turn on away access. Try again.", message: "Home couldn't turn on away access. Try again." }));
    } finally {
      setBusy(false);
    }
  }

  const descriptions: Record<StepId, string> = {
    device: i18n._({ id: "Tailscale lets your family reach Home from their other devices when they are away.", message: "Tailscale lets your family reach Home from their other devices when they are away." }),
    secure: i18n._({ id: "Turn on Tailscale's secure DNS addresses, then connect this Home to your tailnet.", message: "Turn on Tailscale's secure DNS addresses, then connect this Home to your tailnet." }),
    phone: i18n._({ id: "Install Tailscale on your phone, sign in to the same account, then scan this code.", message: "Install Tailscale on your phone, sign in to the same account, then scan this code." }),
  };

  let body;
  if (currentStepId === "device") {
    body = (
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{i18n._({ id: "Install Tailscale on this computer", message: "Install Tailscale on this computer" })}</FieldTitle>
            <FieldDescription>{status?.installed ? i18n._({ id: "Ready", message: "Ready" }) : i18n._({ id: "Install the Tailscale app to continue.", message: "Install the Tailscale app to continue." })}</FieldDescription>
          </FieldContent>
          {!status?.installed ? <Button asChild variant="outline"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">{i18n._({ id: "Get Tailscale", message: "Get Tailscale" })}</a></Button> : null}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{i18n._({ id: "Sign in to Tailscale", message: "Sign in to Tailscale" })}</FieldTitle>
            <FieldDescription>{status?.signedIn ? i18n._({ id: "Ready", message: "Ready" }) : i18n._({ id: "Use the account your family's phones and tablets will use.", message: "Use the account your family's phones and tablets will use." })}</FieldDescription>
          </FieldContent>
        </Field>
        {status && status.installed && !status.signedIn ? <Alert><AlertTitle>{i18n._({ id: "Waiting for sign-in", message: "Waiting for sign-in" })}</AlertTitle><AlertDescription>{i18n._({ id: "Open Tailscale on this computer and sign in. Home will check again automatically.", message: "Open Tailscale on this computer and sign in. Home will check again automatically." })}</AlertDescription></Alert> : null}
      </FieldGroup>
    );
  } else if (currentStepId === "secure") {
    body = (
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{i18n._({ id: "Secure DNS addresses", message: "Secure DNS addresses" })}</FieldTitle>
            <FieldDescription>{status?.httpsEnabled ? i18n._({ id: "Ready", message: "Ready" }) : i18n._({ id: "Turn on HTTPS certificates in Tailscale's DNS settings.", message: "Turn on HTTPS certificates in Tailscale's DNS settings." })}</FieldDescription>
          </FieldContent>
          {!status?.httpsEnabled ? <Button asChild variant="outline"><a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">{i18n._({ id: "Open DNS settings", message: "Open DNS settings" })}</a></Button> : null}
        </Field>
        <Alert>
          <AlertTitle>{i18n._({ id: "About your address", message: "About your address" })}</AlertTitle>
          <AlertDescription>{i18n._({ id: "Turning this on publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale DNS and HTTPS certificates; Headscale is not supported.", message: "Turning this on publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale DNS and HTTPS certificates; Headscale is not supported." })}</AlertDescription>
        </Alert>
        {readyForHomeAccess && !status?.enabled ? <p>{i18n._({ id: "Home is ready to turn on its secure address.", message: "Home is ready to turn on its secure address." })}</p> : null}
      </FieldGroup>
    );
  } else {
    body = address && qrPayload ? (
      <FieldGroup>
        <Field>
          <FieldTitle>{i18n._({ id: "Your Home address", message: "Your Home address" })}</FieldTitle>
          <FieldDescription><a href={address}>{address}</a></FieldDescription>
        </Field>
        <QrCode value={qrPayload} size={192} label={i18n._({ id: "QR code for your Home address away from home", message: "QR code for your Home address away from home" })} />
      </FieldGroup>
    ) : (
      <Alert variant="destructive"><AlertTitle>{i18n._({ id: "Home address unavailable", message: "Home address unavailable" })}</AlertTitle><AlertDescription>{i18n._({ id: "Home could not find its secure address. Refresh the status and try again.", message: "Home could not find its secure address. Refresh the status and try again." })}</AlertDescription></Alert>
    );
  }

  return (
    <Wizard
      steps={steps()}
      currentStepId={currentStepId}
      completedCount={currentIndex}
      onJumpTo={(id) => setStepOverride(id as StepId)}
      layout="default"
      heading={currentStepId === "device" ? i18n._({ id: "Install Tailscale and sign in", message: "Install Tailscale and sign in" }) : currentStepId === "secure" ? i18n._({ id: "Turn on secure addresses", message: "Turn on secure addresses" }) : i18n._({ id: "Scan the code on your phone", message: "Scan the code on your phone" })}
      description={descriptions[currentStepId]}
      progress={{ current: currentIndex + 1, total: steps().length }}
      stickyFooter
      banner={<Button type="button" variant="ghost" onClick={close}>{i18n._({ id: "Close", message: "Close" })}</Button>}
      onBack={currentIndex > 0 ? () => setStepOverride(steps()[currentIndex - 1]!.id as StepId) : undefined}
      onNext={() => {
        if (currentStepId === "device") setStepOverride("secure");
        else if (currentStepId === "secure") {
          if (status?.enabled) setStepOverride("phone");
          else void enableAwayAccess();
        }
        else close();
      }}
      nextLabel={currentStepId === "secure" && !status?.enabled ? i18n._({ id: "Turn on away access", message: "Turn on away access" }) : currentStepId === "phone" ? i18n._({ id: "Done", message: "Done" }) : i18n._({ id: "Continue", message: "Continue" })}
      nextDisabled={currentStepId === "device" ? !status?.installed || !status.signedIn : currentStepId === "secure" ? !readyForHomeAccess : !address}
      busy={busy || status === null}
    >
      {body}
      {error ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "Could not check or update Tailscale", message: "Could not check or update Tailscale" })}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </Wizard>
  );
}
