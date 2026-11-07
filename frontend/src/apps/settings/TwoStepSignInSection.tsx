import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { QrCode } from "@maipai/ui/src/ui/qr-code";
import { api, type Roster } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

export function TwoStepSignInSection({ person }: { person: Roster }) {
  const allowed = person.role === "owner" || person.role === "admin";
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void api.totpStatus().then((result) => { if (live) setEnabled(result.enabled); }).catch(() => { if (live) setError(i18n._({ id: "Could not check two-step sign-in. Check your connection and try again.", message: "Could not check two-step sign-in. Check your connection and try again." })); });
    return () => { live = false; };
  }, [allowed]);

  async function start() {
    setBusy(true); setError("");
    try { setUri((await api.totpEnroll()).uri); setCode(""); }
    catch (cause) { setError(errorLine(cause, i18n._({ id: "Could not start setup. Try again.", message: "Could not start setup. Try again." }))); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      if (uri) { await api.totpVerify(code); setUri(null); setEnabled(true); }
      else { await api.totpDisable(code); setEnabled(false); }
      setCode("");
    } catch (cause) { setError(errorLine(cause, i18n._({ id: "That code did not work. Check it and try again.", message: "That code did not work. Check it and try again." }))); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <div className="flex flex-col gap-4">
    {enabled === false && !uri ? <Button type="button" size="lg" disabled={busy} onClick={() => void start()}>{i18n._({ id: "Turn on", message: "Turn on" })}</Button> : null}
    {uri ? <>
      <p className="text-sm">{i18n._({ id: "Scan this code with an authenticator app, then enter the 6-digit code it shows.", message: "Scan this code with an authenticator app, then enter the 6-digit code it shows." })}</p>
      <QrCode value={uri} size={192} label={i18n._({ id: "Authenticator setup QR code", message: "Authenticator setup QR code" })} />
      <p className="text-sm">{i18n._({ id: "Or enter this setup link in your app:", message: "Or enter this setup link in your app:" })}</p><p className="break-all text-sm">{uri}</p>
      <Label htmlFor="totp-code">{i18n._({ id: "6-digit code", message: "6-digit code" })}</Label>
      <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} />
      <Button type="button" size="lg" disabled={busy || code.length !== 6} onClick={() => void submit()}>{i18n._({ id: "Confirm", message: "Confirm" })}</Button>
    </> : null}
    {enabled === true ? <><p className="text-sm">{i18n._({ id: "Two-step sign-in is on.", message: "Two-step sign-in is on." })}</p><Label htmlFor="totp-code">{i18n._({ id: "Enter a code to turn it off", message: "Enter a code to turn it off" })}</Label><Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} /><Button type="button" size="lg" disabled={busy || code.length !== 6} onClick={() => void submit()}>{i18n._({ id: "Turn off", message: "Turn off" })}</Button></> : null}
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
  </div>;
}
