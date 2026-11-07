import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { errorLine } from "@/lib/hubReachability";
import { useHubMutation } from "@/lib/useHubMutation";

// ENGINES-AI-01: pairing is a wizard, one screen per step, with Back and Next, in the kit Dialog as it ships. The step
// state lives here, in the section; there is no wizard component of its own. The kit's `Wizard` primitive is a
// full-page one (it draws its own <main>, <h1> and page padding), so it is not used inside a dialog or a settings
// column; the steps are named with plain headings, "Step 2 of 5" (the report lists the kit part that is missing).

const steps = (): string[] => [i18n._({ id: "Where the engine runs", message: "Where the engine runs" }), i18n._({ id: "The engine computer's address", message: "The engine computer's address" }), i18n._({ id: "Run one command on the engine computer", message: "Run one command on the engine computer" }), i18n._({ id: "Check the engine computer", message: "Check the engine computer" }), i18n._({ id: "Done", message: "Done" })];
type StepIndex = 0 | 1 | 2 | 3 | 4;

const WHERE_KEY = "engines.stack.where";
const HOST_KEY = "engines.stack.remote.host";
const SSH_PORT_KEY = "engines.stack.remote.ssh_port";

/** What is wrong with the typed address and port, in words that say what to fix; null when both are fine. Checked as
 * the person types, so nothing is sent while it is wrong. */
export function addressProblem(host: string, port: string): { host: string | null; port: string | null } {
  const name = host.trim();
  let hostProblem: string | null = null;
  if (name === "") hostProblem = i18n._({ id: "Enter the engine computer's name or its home network address, for example 192.168.1.20.", message: "Enter the engine computer's name or its home network address, for example 192.168.1.20." });
  else if (/[\s/\\]|:\/\//.test(name)) hostProblem = i18n._({ id: "Enter only the name or the address, with no spaces, no slashes and no http:// in front. For example 192.168.1.20.", message: "Enter only the name or the address, with no spaces, no slashes and no http:// in front. For example 192.168.1.20." });
  const number = Number(port);
  const portProblem = port.trim() !== "" && Number.isInteger(number) && number >= 1 && number <= 65535 ? null : i18n._({ id: "Enter a port number between 1 and 65535. It is usually 22.", message: "Enter a port number between 1 and 65535. It is usually 22." });
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

function hopLine(hop: Hop): string {
  const result = hop.pass ? i18n._({ id: "PASS", message: "PASS" }) : i18n._({ id: "FAIL", message: "FAIL" });
  if (hop.detail && !hop.pass) return i18n._({ id: "{result} hop {id}: {detail}. To fix: {fix}", message: "{result} hop {id}: {detail}. To fix: {fix}", values: { result, id: hop.id, detail: hop.detail, fix: hop.fix } });
  if (hop.detail) return i18n._({ id: "{result} hop {id}: {detail}", message: "{result} hop {id}: {detail}", values: { result, id: hop.id, detail: hop.detail } });
  if (!hop.pass) return i18n._({ id: "{result} hop {id}. To fix: {fix}", message: "{result} hop {id}. To fix: {fix}", values: { result, id: hop.id, fix: hop.fix } });
  return i18n._({ id: "{result} hop {id}", message: "{result} hop {id}", values: { result, id: hop.id } });
}

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
        {copied ? i18n._({ id: "Copied", message: "Copied" }) : i18n._({ id: "Copy", message: "Copy" })}
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
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  // Wizard steps show their failure inline in the open dialog; the revoke confirm uses the shared toast.
  const action = useHubMutation({
    verb: "complete engine setup",
    mutationFn: async (perform: () => Promise<void>) => {
      try { await perform(); }
      catch (err) { setError(errorLine(err, i18n._({ id: "Home could not do that. Check that Home is running, then try again.", message: "Home could not do that. Check that Home is running, then try again." }))); }
    },
  });
  const revokeAction = useHubMutation({ verb: "revoke the link key", mutationFn: () => revoke(), onSuccess: () => setConfirmRevoke(false) });
  const busy = action.busy || revokeAction.busy;

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

  function run(perform: () => Promise<void>) {
    setError(null);
    return action.run(perform);
  }

  const problems = addressProblem(host, port);

  async function save(key: string, value: unknown) {
    const saved = await api.setSetting("household", key, value);
    queryClient.setQueryData(["settings-values", "household"], (previous: typeof household.data) => {
      const rows = previous ?? [];
      return rows.some((entry) => entry.key === saved.key) ? rows.map((entry) => (entry.key === saved.key ? saved : entry)) : [...rows, saved];
    });
  }

  async function next() {
    if (step === 0) {
      await run(async () => {
        if (where !== "another_computer") throw new ApiError(i18n._({ id: "Pairing is for a second computer. Choose Another computer to continue, or close this window to keep the engine on this computer.", message: "Pairing is for a second computer. Choose Another computer to continue, or close this window to keep the engine on this computer." }), 400);
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

  async function checkConnection() {
    try {
      const result = await api.engineConnectionCheck();
      setHops(result.hops);
    } catch (err) {
      setError(i18n._({ id: "{problem} Select Retry, or open Engines and AI and select Check the connection.", message: "{problem} Select Retry, or open Engines and AI and select Check the connection.", values: { problem: errorLine(err, i18n._({ id: "Home could not check the connection.", message: "Home could not check the connection." })) } }));
    }
  }

  // The last screen shows the result of Check the connection as soon as it opens.
  useEffect(() => {
    if (!open || step !== 4) return;
    void action.run(checkConnection);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on arrival at the last step
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
    <Section heading={i18n._({ id: "Engine computer link", message: "Engine computer link" })}>
      <p className="text-base text-muted-foreground">{i18n._({ id: "Key: {value}", message: "Key: {value}", values: { value: status.data.paired ? i18n._({ id: "Present", message: "Present" }) : i18n._({ id: "Not paired", message: "Not paired" }) } })}</p>
      <Button variant="outline" onClick={begin}>{i18n._({ id: "Pair engine computer", message: "Pair engine computer" })}</Button>
      {status.data.paired ? <div className="flex flex-col items-start gap-2"><p className="text-sm text-muted-foreground">{i18n._({ id: "Before revoking, run maipai-engine unpair on the engine computer.", message: "Before revoking, run maipai-engine unpair on the engine computer." })}</p><Button variant="destructive" disabled={busy} onClick={() => setConfirmRevoke(true)}>{i18n._({ id: "Revoke link key", message: "Revoke link key" })}</Button></div> : null}
      {confirmRevoke ? <DestructiveConfirm message={i18n._({ id: "Revoke this engine link key?", message: "Revoke this engine link key?" })} detail={i18n._({ id: "The engine computer will need to be paired again.", message: "The engine computer will need to be paired again." })} confirmLabel={i18n._({ id: "Revoke key", message: "Revoke key" })} busyLabel={i18n._({ id: "Revoking", message: "Revoking" })} busy={revokeAction.busy} onConfirm={() => void revokeAction.run()} onCancel={() => setConfirmRevoke(false)} /> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n._({ id: "Pair engine computer", message: "Pair engine computer" })}</DialogTitle>
            <DialogDescription>{i18n._({ id: "Step {value} of {length}: {STEPS}", message: "Step {value} of {length}: {STEPS}", values: { value: step + 1, length: steps().length, STEPS: steps()[step] } })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {step === 0 ? (
              <>
                <p className="text-base">{i18n._({ id: "Pairing connects Home to a second computer in your home that runs the AI engines. Choose where the engine runs.", message: "Pairing connects Home to a second computer in your home that runs the AI engines. Choose where the engine runs." })}</p>
                <Label htmlFor="pair-where">{i18n._({ id: "Where the engine runs", message: "Where the engine runs" })}</Label>
                <Select value={where} onValueChange={(value) => { if (value) setWhere(value); }} items={[{ value: "this_computer", label: i18n._({ id: "This computer", message: "This computer" }) }, { value: "another_computer", label: i18n._({ id: "Another computer", message: "Another computer" }) }]}>
                  <SelectTrigger id="pair-where" aria-label={i18n._({ id: "Where the engine runs", message: "Where the engine runs" })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="this_computer">{i18n._({ id: "This computer", message: "This computer" })}</SelectItem>
                    <SelectItem value="another_computer">{i18n._({ id: "Another computer", message: "Another computer" })}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <p className="text-base">{i18n._({ id: "Enter the engine computer's name or its home network address, and the port Home uses to reach it securely.", message: "Enter the engine computer's name or its home network address, and the port Home uses to reach it securely." })}</p>
                <Label htmlFor="pair-host">{i18n._({ id: "Engine computer name or address", message: "Engine computer name or address" })}</Label>
                <Input id="pair-host" value={host} onChange={(event) => setHost(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} aria-invalid={problems.host ? true : undefined} aria-describedby="pair-host-problem" />
                <p id="pair-host-problem" className="text-sm text-destructive">{host !== "" ? problems.host : null}</p>
                <Label htmlFor="pair-port">{i18n._({ id: "Secure connection port", message: "Secure connection port" })}</Label>
                <Input id="pair-port" value={port} onChange={(event) => setPort(event.target.value)} disabled={busy} inputMode="numeric" autoComplete="off" aria-invalid={problems.port ? true : undefined} aria-describedby="pair-port-problem" />
                <p id="pair-port-problem" className="text-sm text-destructive">{problems.port}</p>
              </>
            ) : null}
            {step === 2 ? (
              pairing ? (
                <>
                  <p className="text-base">{i18n._({ id: "On the engine computer, open a terminal and run this one command. Copy it with the button.", message: "On the engine computer, open a terminal and run this one command. Copy it with the button." })}</p>
                  <CopyLine label={i18n._({ id: "Pairing command", message: "Pairing command" })} text={pairCommand(origin, pairing.code)} />
                  <p className="text-sm text-muted-foreground">{i18n._({ id: "One-time code:", message: "One-time code:" })} <code>{groupCode(pairing.code)}</code>{". "}{i18n._({ id: "It works once and expires at {toLocaleTimeString}. The command prints a check code. Keep it for the next step.", message: "It works once and expires at {toLocaleTimeString}. The command prints a check code. Keep it for the next step.", values: { toLocaleTimeString: new Date(pairing.expires_at).toLocaleTimeString() } })}</p>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => void run(async () => setPairing(await api.issueEngineLinkPairing()))}>{i18n._({ id: "Get a one-time code", message: "Get a one-time code" })}</Button>
              )
            ) : null}
            {step === 3 ? (
              <>
                <p className="text-base">{i18n._({ id: "Select Check the engine computer. Home reads its security key. Then type the check code the engine computer printed.", message: "Select Check the engine computer. Home reads its security key. Then type the check code the engine computer printed." })}</p>
                <Button variant="outline" disabled={busy} onClick={() => void checkComputer()}>{i18n._({ id: "Check the engine computer", message: "Check the engine computer" })}</Button>
                {scanned ? (
                  <form className="flex flex-col items-start gap-2" onSubmit={(event) => { event.preventDefault(); void pin(); }}>
                    <Label htmlFor="pair-check-code">{i18n._({ id: "Check code from the engine computer", message: "Check code from the engine computer" })}</Label>
                    <Input id="pair-check-code" placeholder={i18n._({ id: "Check code", message: "Check code" })} value={typedCode} onChange={(event) => setTypedCode(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} />
                    <Button type="submit" disabled={busy || !typedCode.trim()}>{i18n._({ id: "Pin this computer", message: "Pin this computer" })}</Button>
                  </form>
                ) : null}
              </>
            ) : null}
            {step === 4 ? (
              <>
                <p className="text-base">{i18n._({ id: "Paired. Home now trusts this engine computer.", message: "Paired. Home now trusts this engine computer." })}</p>
                {hops ? hops.map((hop) => (
                  <p key={hop.id} className="text-sm">{hopLine(hop)}</p>
                )) : error ? <><Button type="button" variant="outline" disabled={busy} onClick={() => { setError(null); setHops(null); void run(checkConnection); }}>{i18n._({ id: "Retry", message: "Retry" })}</Button></> : <RouteSkeleton label={i18n._({ id: "Checking the connection", message: "Checking the connection" })} />}
              </>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            {step > 0 && step < 4 ? <Button type="button" variant="ghost" disabled={busy} onClick={back}>{i18n._({ id: "Back", message: "Back" })}</Button> : null}
            {step < 2 ? <Button type="button" disabled={busy || (step === 1 && (problems.host !== null || problems.port !== null))} onClick={() => void next()}>{i18n._({ id: "Next", message: "Next" })}</Button> : null}
            {step === 2 ? <Button type="button" disabled={busy || !pairing} onClick={() => void next()}>{i18n._({ id: "Next", message: "Next" })}</Button> : null}
            {step === 4 ? <Button type="button" onClick={() => setOpen(false)}>{i18n._({ id: "Close", message: "Close" })}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
