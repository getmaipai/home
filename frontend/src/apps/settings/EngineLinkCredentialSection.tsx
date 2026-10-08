import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { ApiError, api } from "@/lib/api";

export function EngineLinkCredentialSection() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["engine-link-credentials"], queryFn: api.engineLinkCredentialStatus });
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null);
  const [scanned, setScanned] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await action(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not update the engine computer link."); }
    finally { setBusy(false); }
  }

  async function beginPairing() {
    const result = await api.issueEngineLinkPairing();
    setPairing(result);
    setScanned(false);
    setTypedCode("");
  }

  async function scanHostKey() {
    await api.scanEngineLinkHostKey();
    setScanned(true);
  }

  async function confirmHostKey() {
    if (!typedCode.trim()) return;
    try { await api.confirmEngineLinkHostKey(typedCode); }
    catch (err) {
      setTypedCode("");
      if (err instanceof ApiError && err.status === 429) { setScanned(false); setPairing(null); }
      throw err;
    }
    setScanned(false);
    setTypedCode("");
    setPairing(null);
    await queryClient.invalidateQueries({ queryKey: ["engine-link-credentials"] });
  }

  async function revoke() {
    await api.revokeEngineLink();
    setPairing(null);
    setScanned(false);
    setTypedCode("");
    await queryClient.invalidateQueries({ queryKey: ["engine-link-credentials"] });
  }
  if (status.isLoading || status.isError || !status.data) return null;
  return (
    <Section heading="Engine computer link">
      <p className="text-base text-[var(--muted-foreground)]">Key: {status.data.paired ? "Present" : "Not paired"}</p>
      {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
      {!pairing ? <Button variant="outline" disabled={busy} onClick={() => void run(beginPairing)}>Pair engine computer</Button> : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base">One-time code: <code>{pairing.code}</code></p>
          <p className="text-sm text-[var(--muted-foreground)]">Expires {new Date(pairing.expires_at).toLocaleTimeString()}.</p>
          <Button variant="outline" disabled={busy} onClick={() => void run(scanHostKey)}>Check the engine computer</Button>
        </div>
      )}
      {scanned ? (
        <form className="flex max-w-sm flex-col items-start gap-2" onSubmit={(event) => { event.preventDefault(); void run(confirmHostKey); }}>
          <p className="text-base">Type the check code shown on the engine computer.</p>
          <Input aria-label="Check code from the engine computer" placeholder="Check code" value={typedCode} onChange={(event) => setTypedCode(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} />
          <Button type="submit" disabled={busy || !typedCode.trim()}>Pin this computer</Button>
        </form>
      ) : null}
      {status.data.paired ? <div className="flex flex-col items-start gap-2"><p className="text-sm text-[var(--muted-foreground)]">Before revoking, run <code>maipai-engine unpair</code> on the engine computer.</p><Button variant="destructive" disabled={busy} onClick={() => void run(revoke)}>Revoke link key</Button></div> : null}
    </Section>
  );
}
