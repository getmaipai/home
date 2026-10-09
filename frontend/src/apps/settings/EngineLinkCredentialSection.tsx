import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { ApiError, api } from "@/lib/api";

// ENGINES-AI-01: pairing is a wizard, one screen per step, with Back and Next, in the kit Dialog as it ships. The step
// state lives here, in the section; there is no wizard component of its own. The kit's `Wizard` primitive is a
// full-page one (it draws its own <main>, <h1> and page padding), so it is not used inside a dialog or a settings
// column; the steps are named with plain headings, "Step 2 of 5" (the report lists the kit part that is missing).

const STEPS = ["Where the engine runs", "The engine computer's address", "Run one command on the engine computer", "Check the engine computer", "Done"] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

const WHERE_KEY = "engines.stack.where";
const HOST_KEY = "engines.stack.remote.host";
const SSH_PORT_KEY = "engines.stack.remote.ssh_port";

/** What is wrong with the typed address and port, in words that say what to fix; null when both are fine. Checked as
 * the person types, so nothing is sent while it is wrong. */
export function addressProblem(host: string, port: string): { host: string | null; port: string | null } {
  const name = host.trim();
  let hostProblem: string | null = null;
  if (name === "") hostProblem = "Enter the engine computer's name or its home network address, for example 192.168.1.20.";
  else if (/[\s/\\]|:\/\//.test(name)) hostProblem = "Enter only the name or the address, with no spaces, no slashes and no http:// in front. For example 192.168.1.20.";
  const number = Number(port);
  const portProblem = port.trim() !== "" && Number.isInteger(number) && number >= 1 && number <= 65535 ? null : "Enter a port number between 1 and 65535. It is usually 22.";
  return { host: hostProblem, port: portProblem };
}

/** The one-time code as the engine computer's command takes it: groups of four. */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** The command to type on the engine computer: built from the address Home was opened at, so it is the https:// one. */
export function pairCommand(origin: string, code: string): string {
  return `sudo maipai-engine pair ${origin} ${groupCode(code)}`;
}

type Hop = { id: number; pass: boolean; detail?: string; fix: string };

function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code aria-label={label}>{text}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function EngineLinkCredentialSection() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["engine-link-credentials"], queryFn: api.engineLinkCredentialStatus });
  const household = useQuery({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household") });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [where, setWhere] = useState<string>("this_computer");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null);
  const [scanned, setScanned] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  const [hops, setHops] = useState<Hop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What the settings hold now seeds the wizard each time it opens.
  function begin() {
    const value = (key: string) => household.data?.find((entry) => entry.key === key)?.value;
    setWhere(value(WHERE_KEY) === "another_computer" ? "another_computer" : "this_computer");
    setHost(typeof value(HOST_KEY) === "string" ? (value(HOST_KEY) as string) : "");
    setPort(String(typeof value(SSH_PORT_KEY) === "number" ? value(SSH_PORT_KEY) : 22));
    setPairing(null);
    setScanned(false);
    setTypedCode("");
    setHops(null);
    setError(null);
    setStep(0);
    setOpen(true);
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await action(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Home could not do that. Check that Home is running, then try again."); }
    finally { setBusy(false); }
  }

  const problems = addressProblem(host, port);

  async function save(key: string, value: unknown) {
    const saved = await api.setSetting("household", key, value);
    queryClient.setQueryData(["settings-values", "household"], (previous: typeof household.data) => (previous ?? []).map((entry) => (entry.key === saved.key ? saved : entry)));
  }

  async function next() {
    if (step === 0) {
      await run(async () => {
        if (where !== "another_computer") throw new ApiError("Pairing is for a second computer. Choose Another computer to continue, or close this window to keep the engine on this computer.", 400);
        await save(WHERE_KEY, where);
        setStep(1);
      });
    } else if (step === 1) {
      await run(async () => {
        if (problems.host || problems.port) throw new ApiError(problems.host ?? problems.port ?? "", 400);
        await save(HOST_KEY, host.trim());
        await save(SSH_PORT_KEY, Number(port));
        setStep(2);
        setPairing(await api.issueEngineLinkPairing());
      });
    } else if (step === 2) {
      setStep(3);
      setError(null);
    }
  }

  function back() {
    setError(null);
    setStep((current) => (current > 0 ? ((current - 1) as StepIndex) : current));
  }

  async function checkComputer() {
    await run(async () => {
      await api.scanEngineLinkHostKey();
      setScanned(true);
    });
  }

  async function pin() {
    if (!typedCode.trim()) return;
    await run(async () => {
      try { await api.confirmEngineLinkHostKey(typedCode); }
      catch (err) {
        setTypedCode("");
        if (err instanceof ApiError && err.status === 429) { setScanned(false); setPairing(null); setStep(2); }
        throw err;
      }
      setScanned(false);
      setTypedCode("");
      setPairing(null);
      await queryClient.invalidateQueries({ queryKey: ["engine-link-credentials"] });
      setStep(4);
    });
  }

  // The last screen shows the result of Check the connection as soon as it opens.
  useEffect(() => {
    if (!open || step !== 4) return;
    let cancelled = false;
    api.engineConnectionCheck().then(
      (result) => { if (!cancelled) setHops(result.hops); },
      (err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Home could not check the connection. Open Engines and AI and select Check the connection, then try again."); },
    );
    return () => { cancelled = true; };
  }, [open, step]);

  async function revoke() {
    await api.revokeEngineLink();
    setPairing(null);
    setScanned(false);
    setTypedCode("");
    await queryClient.invalidateQueries({ queryKey: ["engine-link-credentials"] });
    await queryClient.invalidateQueries({ queryKey: ["settings-values", "household"] });
  }

  if (status.isLoading || status.isError || !status.data) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Section heading="Engine computer link">
      <p className="text-base text-[var(--muted-foreground)]">Key: {status.data.paired ? "Present" : "Not paired"}</p>
      <Button variant="outline" onClick={begin}>Pair engine computer</Button>
      {status.data.paired ? <div className="flex flex-col items-start gap-2"><p className="text-sm text-[var(--muted-foreground)]">Before revoking, run <code>maipai-engine unpair</code> on the engine computer.</p><Button variant="destructive" disabled={busy} onClick={() => void run(revoke)}>Revoke link key</Button></div> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair engine computer</DialogTitle>
            <DialogDescription>Step {step + 1} of {STEPS.length}: {STEPS[step]}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {step === 0 ? (
              <>
                <p className="text-base">Pairing connects Home to a second computer in your home that runs the AI engines. Choose where the engine runs.</p>
                <Label htmlFor="pair-where">Where the engine runs</Label>
                <Select value={where} onValueChange={(value) => { if (value) setWhere(value); }} items={[{ value: "this_computer", label: "This computer" }, { value: "another_computer", label: "Another computer" }]}>
                  <SelectTrigger id="pair-where" aria-label="Where the engine runs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="this_computer">This computer</SelectItem>
                    <SelectItem value="another_computer">Another computer</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <p className="text-base">Enter the engine computer's name or its home network address, and the port Home uses to reach it securely.</p>
                <Label htmlFor="pair-host">Engine computer name or address</Label>
                <Input id="pair-host" value={host} onChange={(event) => setHost(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} aria-invalid={problems.host ? true : undefined} aria-describedby="pair-host-problem" />
                <p id="pair-host-problem" className="text-sm text-[var(--destructive)]">{host !== "" ? problems.host : null}</p>
                <Label htmlFor="pair-port">Secure connection port</Label>
                <Input id="pair-port" value={port} onChange={(event) => setPort(event.target.value)} disabled={busy} inputMode="numeric" autoComplete="off" aria-invalid={problems.port ? true : undefined} aria-describedby="pair-port-problem" />
                <p id="pair-port-problem" className="text-sm text-[var(--destructive)]">{problems.port}</p>
              </>
            ) : null}
            {step === 2 ? (
              pairing ? (
                <>
                  <p className="text-base">On the engine computer, open a terminal and run this one command. Copy it with the button.</p>
                  <CopyLine label="Pairing command" text={pairCommand(origin, pairing.code)} />
                  <p className="text-sm text-[var(--muted-foreground)]">One-time code: <code>{groupCode(pairing.code)}</code>. It works once and expires at {new Date(pairing.expires_at).toLocaleTimeString()}. The command prints a check code. Keep it for the next step.</p>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => void run(async () => setPairing(await api.issueEngineLinkPairing()))}>Get a one-time code</Button>
              )
            ) : null}
            {step === 3 ? (
              <>
                <p className="text-base">Select Check the engine computer. Home reads its security key. Then type the check code the engine computer printed.</p>
                <Button variant="outline" disabled={busy} onClick={() => void checkComputer()}>Check the engine computer</Button>
                {scanned ? (
                  <form className="flex flex-col items-start gap-2" onSubmit={(event) => { event.preventDefault(); void pin(); }}>
                    <Label htmlFor="pair-check-code">Check code from the engine computer</Label>
                    <Input id="pair-check-code" placeholder="Check code" value={typedCode} onChange={(event) => setTypedCode(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} />
                    <Button type="submit" disabled={busy || !typedCode.trim()}>Pin this computer</Button>
                  </form>
                ) : null}
              </>
            ) : null}
            {step === 4 ? (
              <>
                <p className="text-base">Paired. Home now trusts this engine computer.</p>
                {hops ? hops.map((hop) => (
                  <p key={hop.id} className="text-sm">{hop.pass ? "PASS" : "FAIL"} hop {hop.id}{hop.detail ? `: ${hop.detail}` : ""}{hop.pass ? "" : `. To fix: ${hop.fix}`}</p>
                )) : <p className="text-sm text-[var(--muted-foreground)]">Checking the connection&hellip;</p>}
              </>
            ) : null}
            {error ? <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p> : null}
          </div>
          <DialogFooter>
            {step > 0 && step < 4 ? <Button type="button" variant="ghost" disabled={busy} onClick={back}>Back</Button> : null}
            {step < 2 ? <Button type="button" disabled={busy || (step === 1 && (problems.host !== null || problems.port !== null))} onClick={() => void next()}>Next</Button> : null}
            {step === 2 ? <Button type="button" disabled={busy || !pairing} onClick={() => void next()}>Next</Button> : null}
            {step === 4 ? <Button type="button" onClick={() => setOpen(false)}>Close</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
