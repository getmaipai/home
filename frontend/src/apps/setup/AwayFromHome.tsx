import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type TailscaleStatus } from "@/lib/api";

export function AwayFromHome({ onContinue }: { onContinue: () => void }) {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const poll = () => void api.tailscaleStatus().then((next) => { if (active) setStatus(next); }).catch(() => undefined);
    poll(); const timer = window.setInterval(poll, 4000);
    const focus = () => poll(); window.addEventListener("focus", focus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);
  const ready = Boolean(status?.installed && status.signedIn && status.httpsEnabled);
  async function turnOn() {
    setBusy(true); setError(null);
    try { const result = await api.enableTailscale(); setUrl(result.url); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not turn on away access."); }
    finally { setBusy(false); }
  }
  return <div className="flex max-w-2xl flex-col gap-6">
    <div><h2 className="text-xl font-semibold">Reach Home from anywhere</h2><p className="text-muted-foreground">Tailscale is a free app that links your family's phones and tablets to Home privately. Your conversations go straight between your devices and this computer; Tailscale can't read them.</p></div>
    <ul className="flex flex-col gap-3">
      <li>Install Tailscale on this computer — {status?.installed ? "Ready" : <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get Tailscale</a>}</li>
      <li>Sign in to Tailscale — {status?.signedIn ? "Ready" : "Waiting"}. Use the account your family's devices will use.</li>
      <li>Turn on secure addresses in Tailscale — {status?.httpsEnabled ? "Ready" : <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">Open Tailscale DNS settings</a>}</li>
    </ul>
    <p className="text-sm text-muted-foreground">Turning this on publishes this computer's Tailscale name in public certificate logs. Pick a plain computer name, not a family name. <a href="https://tailscale.com/kb/rename" target="_blank" rel="noreferrer">How to rename it</a></p>
    {url ? <div className="flex flex-col gap-3"><p>On your phone: install Tailscale, sign in with the same account, then open this address.</p><a href={url}>{url}</a><Button onClick={onContinue}>Continue</Button></div> : <div className="flex gap-3"><Button disabled={!ready || busy} onClick={() => void turnOn()}>{busy ? "Turning on…" : "Turn on"}</Button><Button variant="outline" onClick={onContinue}>Set up later</Button><span className="text-sm text-muted-foreground">Until you do, Home works only on your home Wi-Fi.</span></div>}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </div>;
}
