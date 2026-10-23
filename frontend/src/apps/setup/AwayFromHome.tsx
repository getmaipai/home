import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { Button } from "@maipai/ui/src/ui/button";
import { QrCode } from "@maipai/ui/src/ui/qr-code";
import { api, type SignedInPerson, type TailscaleStatus } from "@/lib/api";

const STEPS: WizardStep[] = [
  { id: "device", title: "Install and sign in" },
  { id: "secure", title: "Turn on secure addresses" },
  { id: "phone", title: "Scan the code" },
];
type StepId = (typeof STEPS)[number]["id"];
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

  useEffect(() => {
    if (!isOwnerOrAdmin(operator)) return;
    let active = true;
    const poll = () => void api.tailscaleStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      setError(null);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Home couldn't check Tailscale. Try again.");
    });
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
        <h1>Set up away access</h1>
        {operator ? (
          <>
            <p>Only the owner or an admin can set up away access.</p>
            <p>Ask one of them to finish this setup for your Home.</p>
          </>
        ) : (
          <>
            <p>Sign in to MaiPai Home to continue.</p>
            <p>Only the owner or an admin can set up away access.</p>
          </>
        )}
        <Button asChild variant="link"><Link to="/">Go to Home</Link></Button>
      </main>
    );
  }

  const currentStepId = stepOverride ?? (status ? firstUnfinishedStep(status) : "device");
  const currentIndex = STEPS.findIndex((step) => step.id === currentStepId);
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
      setError(reason instanceof Error ? reason.message : "Home couldn't turn on away access. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const descriptions: Record<StepId, string> = {
    device: "Tailscale lets your family reach Home from their other devices when they are away.",
    secure: "Turn on Tailscale's secure DNS addresses, then connect this Home to your tailnet.",
    phone: "Install Tailscale on your phone, sign in to the same account, then scan this code.",
  };

  let body;
  if (currentStepId === "device") {
    body = (
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Install Tailscale on this computer</FieldTitle>
            <FieldDescription>{status?.installed ? "Ready" : "Install the Tailscale app to continue."}</FieldDescription>
          </FieldContent>
          {!status?.installed ? <Button asChild variant="outline"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get Tailscale</a></Button> : null}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Sign in to Tailscale</FieldTitle>
            <FieldDescription>{status?.signedIn ? "Ready" : "Use the account your family's phones and tablets will use."}</FieldDescription>
          </FieldContent>
        </Field>
        {status && status.installed && !status.signedIn ? <Alert><AlertTitle>Waiting for sign-in</AlertTitle><AlertDescription>Open Tailscale on this computer and sign in. Home will check again automatically.</AlertDescription></Alert> : null}
      </FieldGroup>
    );
  } else if (currentStepId === "secure") {
    body = (
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Secure DNS addresses</FieldTitle>
            <FieldDescription>{status?.httpsEnabled ? "Ready" : "Turn on HTTPS certificates in Tailscale's DNS settings."}</FieldDescription>
          </FieldContent>
          {!status?.httpsEnabled ? <Button asChild variant="outline"><a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">Open DNS settings</a></Button> : null}
        </Field>
        <Alert>
          <AlertTitle>About your address</AlertTitle>
          <AlertDescription>Turning this on publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale DNS and HTTPS certificates; Headscale is not supported.</AlertDescription>
        </Alert>
        {readyForHomeAccess && !status?.enabled ? <p>Home is ready to turn on its secure address.</p> : null}
      </FieldGroup>
    );
  } else {
    body = address && qrPayload ? (
      <FieldGroup>
        <Field>
          <FieldTitle>Your Home address</FieldTitle>
          <FieldDescription><a href={address}>{address}</a></FieldDescription>
        </Field>
        <QrCode value={qrPayload} size={192} label="QR code for your Home address away from home" />
      </FieldGroup>
    ) : (
      <Alert variant="destructive"><AlertTitle>Home address unavailable</AlertTitle><AlertDescription>Home could not find its secure address. Refresh the status and try again.</AlertDescription></Alert>
    );
  }

  return (
    <Wizard
      steps={STEPS}
      currentStepId={currentStepId}
      completedCount={currentIndex}
      onJumpTo={(id) => setStepOverride(id as StepId)}
      layout="default"
      heading={currentStepId === "device" ? "Install Tailscale and sign in" : currentStepId === "secure" ? "Turn on secure addresses" : "Scan the code on your phone"}
      description={descriptions[currentStepId]}
      progress={{ current: currentIndex + 1, total: STEPS.length }}
      stickyFooter
      banner={<Button type="button" variant="ghost" onClick={close}>Close</Button>}
      onBack={currentIndex > 0 ? () => setStepOverride(STEPS[currentIndex - 1]!.id) : undefined}
      onNext={() => {
        if (currentStepId === "device") setStepOverride("secure");
        else if (currentStepId === "secure") {
          if (status?.enabled) setStepOverride("phone");
          else void enableAwayAccess();
        }
        else close();
      }}
      nextLabel={currentStepId === "secure" && !status?.enabled ? "Turn on away access" : currentStepId === "phone" ? "Done" : "Continue"}
      nextDisabled={currentStepId === "device" ? !status?.installed || !status.signedIn : currentStepId === "secure" ? !readyForHomeAccess : !address}
      busy={busy || status === null}
    >
      {body}
      {error ? <Alert variant="destructive"><AlertTitle>Could not check or update Tailscale</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </Wizard>
  );
}
