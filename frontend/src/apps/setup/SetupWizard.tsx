import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Label } from "@maipai/ui/src/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Separator } from "@maipai/ui/src/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { List } from "@maipai/ui/src/primitives/List";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Badge } from "@maipai/ui/src/ui/badge";
import heroContent from "@/content/hero.json";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { api, ApiError } from "@/lib/api";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import { isVisibleModelDownload, modelDownloadProgress, useModelDownloadJobs } from "@/lib/modelDownloadProgress";
import { SetupPreviewBar } from "./preview/SetupPreviewBar";
import { NewPersonForm } from "@/apps/people/NewPersonForm";

interface SetupWizardProps { onDone: () => void; initialScreen?: ScreenId }

declare global {
  interface Window { __setupPreview?: boolean }
}

const PHASES: WizardStep[] = [
  { id: "computers", title: "Your computers" },
  { id: "meet", title: "Meet your Home" },
];
const SCREEN_IDS = ["welcome", "engine_location", "storage", "checks", "plan", "owner", "face", "hello", "done"] as const;
type ScreenId = (typeof SCREEN_IDS)[number];
const SCREEN_TITLE: Record<ScreenId, string> = {
  welcome: "Welcome to MaiPai Home",
  engine_location: "Where should Home's AI run?",
  storage: "Where should Home keep its files?",
  checks: "Checking your computers",
  plan: "Here's the plan for your Home",
  owner: "Create your owner account",
  face: "Let Home recognise you",
  hello: "Hello",
  done: "You're all set",
};
const COPY_HOME = "Your own AI, music, videos, podcasts, maps, books, and more, on your own hardware, online or offline - for protection, privacy, and independence.";
const PRIVACY_COPY = heroContent.find((item) => item.id === "hero.privacy")!.text;
const DISCLAIMER = "Home's answers come from AI models you choose to download. They can be wrong, offensive or harmful, and they are not medical, legal or professional advice. You are responsible for how you use them.";
const OWNER_COPY = "You're the owner. You're in charge of this Home: who's in the family, who helps run it, where things are stored, and the backups. Nobody can remove you.";
const ADMIN_COPY = "Later you can add admins. An admin is a trusted helper, like another parent. They can add apps and look after settings, but they can't change who's in charge, reset Home or bring back a whole backup.";
const stepIsDone = (state: SetupState, id: string) => state.steps.find((step) => step.id === id)?.status === "done";

export function renderSetupReviewScreen({ screen, engine = "this_computer", onEngineChange, searchCandidate, onChooseSearchCandidate, searchError, busy = false, readOnly = false, checkRows, checkError = false, checksFetching = false, onRetryChecks }: {
  screen: "engine_location" | "storage" | "checks" | "plan";
  engine?: "this_computer" | "another_computer";
  onEngineChange?: (value: "this_computer" | "another_computer") => void;
  searchCandidate?: string | null;
  onChooseSearchCandidate?: () => void;
  searchError?: string | null;
  busy?: boolean;
  readOnly?: boolean;
  checkRows?: Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }> | null;
  checkError?: boolean;
  checksFetching?: boolean;
  onRetryChecks?: () => void;
}) {
  if (screen === "engine_location") return <Card><CardHeader><CardTitle>{SCREEN_TITLE.engine_location}</CardTitle></CardHeader><CardContent><RadioGroup disabled={readOnly} value={engine} onValueChange={(v) => onEngineChange?.(v as typeof engine)}><div className="flex items-start gap-3"><RadioGroupItem value="this_computer" id="engine-local" /><div><Label htmlFor="engine-local">This computer</Label><p>Simplest. Home and its AI share this computer.</p></div></div><div className="flex items-start gap-3"><RadioGroupItem value="another_computer" id="engine-remote" /><div><Label htmlFor="engine-remote">Another computer on my network</Label><p>For a bigger computer elsewhere in the house, like a gaming PC or a Mac Studio.</p></div></div></RadioGroup>{engine === "another_computer" ? <p role="status">The engine-link pairing flow is available in Home settings, AI. Pairing and saving an engine link during first-run setup is not supported by the current setup API.</p> : null}</CardContent></Card>;
  if (screen === "storage") return <Card><CardHeader><CardTitle>{SCREEN_TITLE.storage}</CardTitle><CardDescription>AI models are big (7 to 10 GB). The Stack's default location is ready to use.</CardDescription></CardHeader><CardContent><p>Use the default location on the engine computer.</p><p className="text-sm text-muted-foreground">Choosing another location is not available yet.</p></CardContent></Card>;
  if (screen === "plan") return <Card><CardHeader><CardTitle>{SCREEN_TITLE.plan}</CardTitle></CardHeader><CardContent><p>Hardware checks and the Stack's plan recommendations are not built into setup yet. No plan has been installed or selected.</p><p>Web search: Home's own private search.</p>{searchCandidate ? <><p>Found a SearXNG on this computer.</p><Button type="button" variant="secondary" disabled={busy} onClick={onChooseSearchCandidate}>Use it</Button></> : null}{searchError ? <p role="alert">{searchError}</p> : null}</CardContent></Card>;
  return <Card><CardHeader><CardTitle>{SCREEN_TITLE.checks}</CardTitle></CardHeader><CardContent><AsyncState data={checkRows ?? null} error={checkError} isFetching={checksFetching} onRetry={onRetryChecks ?? (() => {})} errorMessage="Home couldn't check these computers. Refresh this page and try again." loadingLabel="Checking your computers">{(items) => <List items={items} getKey={(row) => row.id} label="Setup checks" renderItem={(row) => <div className="flex min-w-0 flex-1 flex-col gap-1 py-1"><div className="flex items-center gap-2"><Badge variant={row.state === "red" ? "destructive" : row.state === "amber" ? "outline" : "secondary"}>{row.state}</Badge><span className="font-medium">{row.title}</span></div><p className="text-sm text-muted-foreground">{row.text}</p></div>} />}</AsyncState></CardContent></Card>;
}

export function SetupWizard({ onDone, initialScreen }: SetupWizardProps) {
  const ownerFormRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();
  const downloads = useModelDownloadJobs();
  const [state, setState] = useState<SetupState | null>(null);
  const [screen, setScreen] = useState<ScreenId>(initialScreen ?? "welcome");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<"this_computer" | "another_computer">("this_computer");
  const [ownerName] = useState("");
  const [ownerSecret] = useState("");
  const [certificate, setCertificate] = useState<"loading" | "ready" | "error">("loading");
  const [backupKey, setBackupKey] = useState<{ hubName: string; hubInstanceId: string; backupKeyHex: string; generatedAt: string } | null>(null);
  const [backupKeyError, setBackupKeyError] = useState(false);
  const [checkRows, setCheckRows] = useState<Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }> | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [checksFetching, setChecksFetching] = useState(false);
  const [tailnetError, setTailnetError] = useState<string | null>(null);
  const [searchCandidate, setSearchCandidate] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const refresh = async () => {
    const result = await api.setupState();
    if ("done" in result) {
      if (!initialScreen) navigate("/sign-in", { replace: true });
      return null;
    }
    if (!initialScreen && (result.completed_at !== null || stepIsDone(result, "done"))) {
      navigate("/sign-in", { replace: true });
      return null;
    }
    setState(result);
    // `away` remains in the persisted setup contract for older records, but
    // is now completed from the post-setup checklist rather than first run.
    const firstPending = result.steps.find((step) => step.id !== "away" && (step.status === "pending" || step.status === "running" || step.status === "failed"))?.id;
    // The common new-person profile flow is not built. The plan explicitly
    // removes screen 9 until it exists, so its server record is not a UI step.
    const next = firstPending === "profile" ? "hello" : firstPending;
    if (next && (SCREEN_IDS as readonly string[]).includes(next)) setScreen(next as ScreenId);
    setEngine(result.engine.where);
    return result;
  };

  useEffect(() => {
    void refresh().catch(() => setError("Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again.")).finally(() => setLoading(false));
    // State is loaded once on mount. Every mutation below refreshes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen !== "done") return;
    void api.setupCa().then(() => setCertificate("ready"), () => setCertificate("error"));
    void api.emergencyKit().then((kit) => { setBackupKey(kit); setBackupKeyError(false); }, () => setBackupKeyError(true));
  }, [screen]);

  useEffect(() => {
    if (screen !== "checks") return;
    let active = true;
    setChecksFetching(true);
    void api.setupChecks().then((result) => {
      if (!active) return;
      setCheckRows(result.rows);
      setState(result.state);
      setSearchCandidate(result.searchCandidate);
      setCheckError(false);
      if (result.rows.every((row) => row.state === "green" || row.state === "idle" || (row.id === "web-search" && row.state === "amber"))) {
        window.setTimeout(() => { if (active) setScreen("plan"); }, 1500);
      }
    }, () => { if (active) setCheckError(true); }).finally(() => { if (active) setChecksFetching(false); });
    return () => { active = false; };
  }, [screen]);

  async function loadEmergencyKit() {
    try {
      const kit = await api.emergencyKit();
      setBackupKey(kit);
      setBackupKeyError(false);
      return kit;
    } catch {
      setBackupKeyError(true);
      return null;
    }
  }

  async function downloadEmergencyKit() {
    const kit = backupKey ?? await loadEmergencyKit();
    if (!kit) return;
    const file = `MaiPai Home emergency kit\nHome: ${kit.hubName}\nHome id: ${kit.hubInstanceId}\nBackup key: ${kit.backupKeyHex}\nCreated: ${kit.generatedAt}\n`;
    const url = URL.createObjectURL(new Blob([file], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "maipai-home-emergency-kit.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function printEmergencyKit() {
    const popup = window.open("", "maipai-emergency-kit");
    if (!popup) { setBackupKeyError(true); return; }
    const kit = backupKey ?? await loadEmergencyKit();
    if (!kit) { popup.close(); return; }
    const title = popup.document.createElement("h1");
    title.textContent = "MaiPai Home emergency kit";
    const details = popup.document.createElement("p");
    details.textContent = `Home: ${kit.hubName} · Home id: ${kit.hubInstanceId}`;
    const key = popup.document.createElement("pre");
    key.textContent = kit.backupKeyHex;
    const storage = popup.document.createElement("p");
    storage.textContent = "Keep this key somewhere other than this computer.";
    popup.document.body.replaceChildren(title, details, key, storage);
    popup.document.title = "MaiPai Home emergency kit";
    popup.focus();
    popup.print();
  }

  const phase = screen === "owner" || screen === "face" || screen === "hello" || screen === "done" ? "meet" : "computers";
  const completedCount = phase === "meet" ? 1 : 0;
  const pendingThings = state && (stepIsDone(state, "face") || state.steps.find((step) => step.id === "face")?.status === "deferred") ? 1 : 2;

  async function record(id: string, status: "done" | "skipped" | "deferred" = "done") {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setupStep(id, { status, phase: phaseFor(id) });
      if (!("done" in updated)) setState(updated);
      return updated;
    } catch (reason) {
      const message = reason instanceof ApiError && reason.status === 409 ? "Home is already set up. Sign in instead." : reason instanceof Error ? reason.message : "Home couldn't save this step. Try again.";
      setError(message);
      if (message === "Home is already set up. Sign in instead.") navigate("/sign-in", { replace: true });
      return null;
    } finally { setBusy(false); }
  }

  async function next() {
    const deferred = ["checks", "plan", "hello"].includes(screen) || (screen === "engine_location" && engine === "another_computer");
    const updated = await record(screen, deferred ? "deferred" : "done");
    if (!updated) return;
    if (screen === "face") await api.setupStep("profile", { status: "skipped", phase: "meet" });
    const index = SCREEN_IDS.indexOf(screen);
    const following = SCREEN_IDS[index + 1];
    if (following) setScreen(following);
  }

  async function defer() {
    const updated = await record(screen, "deferred");
    if (!updated) return;
    if (screen === "face") await api.setupStep("profile", { status: "skipped", phase: "meet" });
    setScreen(SCREEN_IDS[SCREEN_IDS.indexOf(screen) + 1] ?? "done");
  }

  async function submitOwner(name = ownerName, secret = ownerSecret) {
    if (!name.trim() || !secret) return;
    setBusy(true);
    setError(null);
    try {
      await api.setup(name.trim(), secret);
      const updated = await api.setupStep("owner", { status: "done", phase: "meet" });
      setState(updated);
      setScreen("face");
    } catch (reason) {
      const message = reason instanceof ApiError && reason.status === 409 ? "Home is already set up. Sign in instead." : reason instanceof Error ? reason.message : "Home couldn't save your account. Press Continue again.";
      setError(message);
      if (message === "Home is already set up. Sign in instead.") navigate("/sign-in", { replace: true });
    } finally { setBusy(false); }
  }

  async function finish() {
    const updated = await record("done");
    if (!updated) return;
    onDone();
    navigate("/sign-in", { replace: true });
  }

  async function allowEngineTailnet() {
    setBusy(true);
    setTailnetError(null);
    try {
      const action = checkRows?.find((row) => row.action === "allow_tailnet");
      if (action?.actionRoute === "settings") await api.setSetting("household", "engines.stack.remote.allow_tailnet", true);
      else await api.setupAllowEngineTailnet();
      const result = await api.setupChecks(); setCheckRows(result.rows); setState(result.state); setSearchCandidate(result.searchCandidate);
    }
    catch (reason) { setTailnetError(reason instanceof Error ? reason.message : "Home couldn't allow Tailscale for the engine link. Sign in as an owner or admin, then try again."); }
    finally { setBusy(false); }
  }

  async function chooseSearchCandidate() {
    if (!searchCandidate) return;
    setBusy(true); setSearchError(null);
    try { await api.setupUseSearchCandidate(searchCandidate); setSearchCandidate(null); }
    catch (reason) { setSearchError(reason instanceof Error ? reason.message : "Home couldn't choose this search service."); }
    finally { setBusy(false); }
  }

  function moveToPhase(id: string) {
    if (id === "computers") setScreen("welcome");
    if (id === "meet") setScreen("owner");
  }
  const back = () => {
    const index = SCREEN_IDS.indexOf(screen);
    if (index > 0) setScreen(SCREEN_IDS[index - 1]!);
  };

  if (loading) return null;
  if (!state) return <main><Card><CardHeader><CardTitle>Setup progress unavailable</CardTitle></CardHeader><CardContent><p role="alert">{error ?? "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."}</p><Button type="button" onClick={() => { setLoading(true); setError(null); void refresh().catch(() => setError("Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again.")).finally(() => setLoading(false)); }}>Try again</Button></CardContent></Card></main>;

  let body;
  switch (screen) {
    case "welcome": body = <Card><CardHeader><img src="/brand/maipai-home-logo-light.png" alt="MaiPai Home" width="280" /><CardTitle>Welcome to MaiPai Home</CardTitle><CardDescription>{COPY_HOME}</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-3"><p>{PRIVACY_COPY}</p><p>No account with us, no subscription, no tracking.</p><p>Kids get their own safe profiles. Parents decide what they can access.</p><p>{DISCLAIMER}</p><Button type="button" variant="link" disabled>Restore from a backup</Button><p className="text-sm text-muted-foreground">Restore from a backup is not available in this setup build.</p></div></CardContent></Card>; break;
    case "engine_location": body = renderSetupReviewScreen({ screen: "engine_location", engine, onEngineChange: setEngine }); break;
    case "storage": body = renderSetupReviewScreen({ screen: "storage" }); break;
    case "checks": {
      const blocking = checkRows?.some((row) => row.state === "red") ?? false;
      const warnings = checkRows?.some((row) => row.state === "amber") ?? false;
      body = initialScreen === "checks" ? renderSetupReviewScreen({ screen: "checks", checkRows, checkError, checksFetching, onRetryChecks: () => { setCheckError(false); setChecksFetching(true); void api.setupChecks().then((result) => { setCheckRows(result.rows); setState(result.state); setSearchCandidate(result.searchCandidate); }, () => setCheckError(true)).finally(() => setChecksFetching(false)); } }) : <Card><CardHeader><CardTitle>{SCREEN_TITLE[screen]}</CardTitle></CardHeader><CardContent>
        <AsyncState data={checkRows} error={checkError} isFetching={checksFetching} onRetry={() => { setCheckError(false); setChecksFetching(true); void api.setupChecks().then((result) => { setCheckRows(result.rows); setState(result.state); setSearchCandidate(result.searchCandidate); if (result.rows.every((row) => row.state === "green" || row.state === "idle" || (row.id === "web-search" && row.state === "amber"))) window.setTimeout(() => setScreen("plan"), 1500); }, () => setCheckError(true)).finally(() => setChecksFetching(false)); }} errorMessage="Home couldn't check these computers." loadingLabel="Checking your computers">
          {(rows) => <List items={rows} getKey={(row) => row.id} label="Setup checks" renderItem={(row) => <div className="flex min-w-0 flex-1 flex-col gap-1 py-1"><div className="flex items-center gap-2"><Badge variant={row.state === "red" ? "destructive" : row.state === "amber" ? "outline" : "secondary"}>{row.state}</Badge><span className="font-medium">{row.title}</span></div><p className="text-sm text-muted-foreground">{row.text}</p>{row.action === "allow_tailnet" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void allowEngineTailnet()}>{row.actionLabel ?? "Allow"}</Button> : null}</div>} />}
        </AsyncState>
        {tailnetError ? <p role="alert">{tailnetError}</p> : null}
        {checkRows?.filter((row) => row.state === "amber" || row.state === "red").map((row) => <Alert key={row.id} variant={row.state === "red" ? "destructive" : "default"}><AlertTitle>{row.title}</AlertTitle><AlertDescription>{row.text}</AlertDescription></Alert>)}
        {blocking ? <p>Fix the red checks, then press Try again.</p> : null}
        {warnings && !blocking ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { void record("checks", "deferred").then((updated) => { if (updated) setScreen("plan"); }); }}>Continue anyway</Button> : null}
        <Button type="button" variant="link" onClick={() => setScreen("welcome")}>Restore from a backup</Button>
      </CardContent></Card>;
      break;
    }
    case "plan": body = renderSetupReviewScreen({ screen: "plan", searchCandidate, onChooseSearchCandidate: () => void chooseSearchCandidate(), searchError, busy }); break;
    case "owner": body = <Card><CardHeader><CardTitle>{SCREEN_TITLE[screen]}</CardTitle></CardHeader><CardContent><Card><CardHeader><CardTitle>Owner or admin?</CardTitle></CardHeader><CardContent><p>{OWNER_COPY}</p><p>{ADMIN_COPY}</p></CardContent></Card><Separator /><NewPersonForm formRef={ownerFormRef} actorRole="owner" fixedRole="owner" onSubmit={async (values) => { await submitOwner(values.displayName, values.secret ?? ""); }} submitLabel="Create owner account" busy={busy} error={error} /></CardContent></Card>; break;
    case "face": body = <Card><CardHeader><CardTitle>Let Home recognise you</CardTitle><CardDescription>Home can greet you by face. Your face is stored as numbers on this computer only.</CardDescription></CardHeader><CardContent><p>Face enrollment is available from your profile after setup.</p></CardContent></Card>; break;
    case "hello": body = <Card><CardHeader><CardTitle>Hello</CardTitle></CardHeader><CardContent><p>The first greeting is not built yet. No greeting has been generated.</p></CardContent></Card>; break;
    case "done": body = <Card><CardHeader><CardTitle>Your Home is ready</CardTitle><CardDescription>Try these first:</CardDescription></CardHeader><CardContent><ul><li>Ask Home a question</li><li>Add your family</li><li>Add apps</li></ul><Separator /><div><h2>Save your backup key</h2><p>If this computer breaks, this file brings your Home back on a new one. Keep it somewhere other than this computer.</p><Button type="button" variant="secondary" disabled={!backupKey} onClick={() => void downloadEmergencyKit()}>Download</Button><Button type="button" variant="secondary" disabled={!backupKey} onClick={() => void printEmergencyKit()}>Print</Button>{backupKeyError ? <p role="alert">Home couldn't make your backup key. Press Download again. If it fails again, Home will show a fix under Home settings, Repairs.</p> : null}</div><Separator /><div><h2>Add a phone or tablet</h2><p>Install Tailscale on it, sign in with the same account, and scan this.</p><p>Phone setup and secure address QR codes are not available yet.</p></div><p>{pendingThings} things left to finish setting up. You'll find them in Home settings.</p>{certificate === "error" ? <p role="alert">Home couldn't make the certificate for your other devices. Phones and tablets can still use Home from this computer's address for now. Open Home settings, Repairs to fix it.</p> : null}</CardContent></Card>; break;
  }

  const phaseStep = PHASES.find((item) => item.id === phase)!.id;
  const screenIndex = SCREEN_IDS.indexOf(screen);
  const submit = screen === "owner" ? submitOwner : screen === "done" ? finish : screen === "face" ? defer : next;
  const previewBanner = window.__setupPreview ? <SetupPreviewBar currentScreen={screenIndex + 1} onJump={(index) => setScreen(SCREEN_IDS[Math.max(0, Math.min(SCREEN_IDS.length - 1, index))]!)} /> : undefined;
  return <Wizard steps={PHASES} currentStepId={phaseStep} completedCount={completedCount} onJumpTo={screen === "owner" ? () => ownerFormRef.current?.requestSubmit() : moveToPhase} onBack={screenIndex > 0 ? back : undefined} onNext={() => screen === "owner" ? ownerFormRef.current?.requestSubmit() : void submit()} nextLabel={screen === "welcome" ? "Set up my Home" : screen === "face" ? "Do this later" : screen === "done" ? "Open my Home" : screen === "checks" && checkRows?.some((row) => row.state === "red") ? "Try again" : "Continue"} nextDisabled={screen === "owner" ? busy : screen === "checks" && (checksFetching || !!checkRows?.some((row) => row.state === "red") || !!checkRows?.every((row) => row.state === "green" || row.state === "idle"))} busy={busy || (screen === "done" && certificate === "loading")} phaseMode banner={previewBanner}>{downloads.filter((job) => isVisibleModelDownload(job)).map((job) => <JobProgress key={job.id} {...modelDownloadProgress(job)} variant="compact" cancelable={job.actions?.includes("stop")} onCancel={job.actions?.includes("stop") ? () => { void api.stopJob(job.id); } : undefined} />)}{body}{error && screen !== "owner" ? <p role="alert">{error}</p> : null}</Wizard>;
}

function phaseFor(id: string): SetupState["phase"] {
  if (id === "done") return "done";
  if (["owner", "face", "profile", "hello"].includes(id)) return "meet";
  return "computers";
}
