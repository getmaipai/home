import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { CheckGrid } from "./CheckGrid";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@maipai/ui/src/dashboard/components/ui/accordion";
import { Field, FieldContent, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError } from "@/lib/api";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import { isVisibleModelDownload, modelDownloadProgress, useModelDownloadJobs } from "@/lib/modelDownloadProgress";
import { setupChecklistCountLine } from "@/shell/useSetupChecklist";
import { SetupPreviewBar } from "./preview/SetupPreviewBar";
import { useIsDark } from "@/shell/ThemeToggle";
import { InstallStrip } from "@/shell/InstallStrip";
import { PlanStep } from "./PlanStep";
import { StorageStep, type StorageChoice } from "./StorageStep";
import { NewPersonForm } from "@/apps/people/NewPersonForm";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";

interface SetupWizardProps { onDone: () => void; initialScreen?: ScreenId }

declare global {
  interface Window { __setupPreview?: boolean }
}

const PHASES: WizardStep[] = [
  { id: "computers", title: "Your Home" },
  { id: "meet", title: "Your AI" },
];
const SCREEN_IDS = ["welcome", "before_start", "engine_location", "storage", "checks", "plan", "owner", "face", "hello", "backup", "done"] as const;
type ScreenId = (typeof SCREEN_IDS)[number];
const SCREEN_TITLE: Record<ScreenId, string> = {
  welcome: "Welcome to MaiPai Home",
  before_start: "Before you start",
  engine_location: "How should Home run?",
  storage: "Choose where to store data",
  checks: "Checking your computers",
  plan: "Your setup plan",
  owner: "Create your owner account",
  face: "Let Home greet you",
  hello: "Hello",
  backup: "Save your backup key",
  done: "You're all set",
};
const SCREEN_DESCRIPTION: Record<ScreenId, string> = {
  welcome: "Your family's private AI, in your own home.",
  before_start: "Home is built to protect your family and your data. Like any AI or online tool, it works best when you know a few things.",
  engine_location: "Choose one computer, or add a bigger one for the AI.",
  storage: "Keep the defaults or pick your own.",
  checks: "Home is checking that everything is ready.",
  plan: "Review the steps Home will complete.",
  owner: "Create the account that manages this Home.",
  face: "You can choose a face greeting now or later.",
  hello: "You can talk with Home after setup.",
  backup: "Save this key somewhere other than this computer.",
  done: "Your Home is ready to use.",
};
const SCREEN_ART: Partial<Record<ScreenId, string>> = {
  welcome: "/setup-art/welcome.webp",
  before_start: "/setup-art/before-you-start.webp",
  engine_location: "/setup-art/where.webp",
  storage: "/setup-art/storage.webp",
  plan: "/setup-art/plan.webp",
  hello: "/setup-art/hello.webp",
  owner: "/setup-art/owner.webp",
  face: "/setup-art/face-intro.webp",
  backup: "/setup-art/backup.webp",
  checks: "/setup-art/checking.webp",
  done: "/setup-art/done.webp",
};
const BEFORE_START_DETAILS = [
  { id: "ai", title: "AI can be wrong or say the wrong thing", detail: "Answers can be inaccurate, offensive, or harmful. They are not medical, legal, or professional advice, and you are responsible for how you use them." },
  { id: "kids", title: "Kids may still see things they shouldn't", detail: "Child profiles start restricted, and parents choose what they can reach. No protection is perfect, so stay involved." },
  { id: "attachment", title: "People can grow attached to AI", detail: "It is easy to feel close to a chatbot or companion, so keep real relationships first and talk with children about it. In Home settings, under Users, you can turn off AI companions for one person or for the household." },
  { id: "internet", title: "Home goes online for you", detail: "Home fetches downloads, updates, and searches you ask for the way you would. Some sites limit, block, or disallow automated visits, so now and then a site may not work." },
];
const OWNER_COPY = "You manage this Home, its people, files, and backups. Nobody can remove the owner.";
const SECRET_SERVER_TEXT = "secret must be 4-128 characters";
const SECRET_LENGTH_COPY = "Use 4 to 128 characters for your PIN or password, then press Create owner account again.";
const stepIsDone = (state: SetupState, id: string) => state.steps.find((step) => step.id === id)?.status === "done";

export function renderSetupReviewScreen({ screen, engine = "this_computer", onEngineChange, searchCandidate, onChooseSearchCandidate, searchError, busy = false, readOnly = false, checkRows, checkError = false, checksFetching = false, onRetryChecks, showTitle = true }: {
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
  showTitle?: boolean;
}) {
  if (screen === "engine_location") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.engine_location}</CardTitle></CardHeader> : null}<CardContent><RadioGroup disabled={readOnly} value={engine} onValueChange={(v) => onEngineChange?.(v as typeof engine)}><FieldLabel htmlFor="engine-local"><Field orientation="horizontal"><RadioGroupItem value="this_computer" id="engine-local" /><FieldContent><span className="text-base font-medium md:text-lg">One computer</span><p className="text-base text-muted-foreground md:text-lg">Home and AI both run on this computer.</p></FieldContent></Field></FieldLabel><FieldLabel htmlFor="engine-remote"><Field orientation="horizontal"><RadioGroupItem value="another_computer" id="engine-remote" /><FieldContent><span className="text-base font-medium md:text-lg">Two computers</span><p className="text-base text-muted-foreground md:text-lg">Home runs on this computer. The AI runs on a bigger, more powerful computer on your network. You pair it on the last screen of setup.</p></FieldContent></Field></FieldLabel></RadioGroup></CardContent></Card>;
  if (screen === "storage") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.storage}</CardTitle><CardDescription>Home uses its ready-to-use default folder.</CardDescription></CardHeader> : null}<CardContent>{!showTitle ? <p>Home will use its default folder for AI models.</p> : null}</CardContent></Card>;
  if (screen === "plan") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.plan}</CardTitle></CardHeader> : null}<CardContent><p>After setup, choose and download AI models in Home settings.</p>{searchCandidate ? <><p>Found a private search service on this computer.</p><Button type="button" variant="secondary" disabled={busy} onClick={onChooseSearchCandidate}>Use it</Button></> : null}{searchError ? <p role="alert">{searchError}</p> : null}</CardContent></Card>;
  return <div>{showTitle ? <h2 className="mb-4 text-lg font-medium">{SCREEN_TITLE.checks}</h2> : null}<AsyncState data={checkRows ?? null} error={checkError} isFetching={checksFetching} onRetry={onRetryChecks ?? (() => {})} errorMessage="Home couldn't check these computers. Refresh this page and try again." loadingLabel="Checking your computers">{(items) => <CheckGrid rows={items} split={engine === "another_computer"} />}</AsyncState></div>;
}

export function SetupWizard({ onDone, initialScreen }: SetupWizardProps) {
  const ownerFormRef = useRef<HTMLFormElement>(null);
  const dark = useIsDark();
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
  const [backupSavedError, setBackupSavedError] = useState(false);
  const [checkRows, setCheckRows] = useState<Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }> | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [checksFetching, setChecksFetching] = useState(false);
  const [checksRun, setChecksRun] = useState(0);
  const arrivedByBack = useRef(false);
  const planInstalled = useRef(false);
  const [openThings, setOpenThings] = useState<number | null>(null);
  const [tailnetError, setTailnetError] = useState<string | null>(null);
  const [searchCandidate, setSearchCandidate] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [storageChoice, setStorageChoice] = useState<StorageChoice>({});
  const [storageBlocked, setStorageBlocked] = useState(false);

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
    const ownerDone = stepIsDone(result, "owner");
    const disclosureSeen = sessionStorage.getItem("maipai:setup-before-start-read") === "true";
    const next = !ownerDone && !disclosureSeen && firstPending !== "welcome" ? "before_start" : firstPending === "profile" ? "hello" : firstPending === "backup_key" ? "backup" : firstPending;
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
    if (screen !== "backup" && screen !== "done") return;
    void api.setupCa().then(() => setCertificate("ready"), () => setCertificate("error"));
    void api.emergencyKit().then((kit) => { setBackupKey(kit); setBackupKeyError(false); }, () => setBackupKeyError(true));
    // The hub's own checklist is the one source for this number.
    void api.setupChecklist().then((items) => setOpenThings(items.filter((item) => !item.done).length), () => setOpenThings(null));
  }, [screen]);

  useEffect(() => {
    if (screen !== "checks") return;
    let active = true;
    let timer: number | undefined;
    setChecksFetching(true);
    void api.setupChecks().then((result) => {
      if (!active) return;
      setCheckRows(result.rows);
      setState(result.state);
      setSearchCandidate(result.searchCandidate);
      setCheckError(false);
      if (result.rows.every((row) => row.state === "green" || row.state === "idle" || (row.id === "web-search" && row.state === "amber"))) {
        if (!arrivedByBack.current) timer = window.setTimeout(() => { if (active) setScreen("plan"); }, 1500);
      }
    }, () => { if (active) setCheckError(true); }).finally(() => { if (active) setChecksFetching(false); });
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [screen, checksRun]);

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
    link.download = "maipai-home-emergency-backup-key.txt";
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

  async function confirmBackupKeySaved() {
    setBusy(true);
    try {
      await api.setupStep("backup_key", { status: "done", phase: "meet" });
      setBackupSavedError(false);
      setOpenThings((count) => count === null ? null : Math.max(0, count - 1));
    } catch {
      setBackupSavedError(true);
    } finally {
      setBusy(false);
    }
  }

  const phase = screen === "owner" || screen === "face" || screen === "hello" || screen === "backup" || screen === "done" ? "meet" : "computers";
  const completedCount = phase === "meet" ? 1 : 0;
  const thingsLeftLine = openThings === null ? null : setupChecklistCountLine(openThings);

  async function record(id: string, status: "done" | "skipped" | "deferred" = "done", extra: { models?: string; records?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setupStep(id, { status, phase: phaseFor(id), ...extra });
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
    if (screen === "welcome") {
      setScreen("before_start");
      return;
    }
    if (screen === "backup") {
      setScreen("done");
      return;
    }
    const stepId = screen === "before_start" ? "welcome" : screen;
    const deferred = (["checks", "plan", "hello"].includes(stepId) && !(stepId === "plan" && planInstalled.current)) || (screen === "engine_location" && engine === "another_computer");
    // The models folder belongs to the engine computer on a split setup, so it is never sent.
    const folders = screen === "storage" ? { ...(engine === "this_computer" && storageChoice.models ? { models: storageChoice.models } : {}), ...(storageChoice.records ? { records: storageChoice.records } : {}) } : {};
    const updated = await record(stepId, deferred ? "deferred" : "done", folders);
    if (!updated) return;
    if (screen === "before_start") {
      sessionStorage.setItem("maipai:setup-before-start-read", "true");
      const firstPending = updated.steps.find((step) => step.id !== "away" && (step.status === "pending" || step.status === "running" || step.status === "failed"))?.id;
      const target = firstPending === "profile" ? "hello" : firstPending === "backup_key" ? "backup" : firstPending;
      if (target && (SCREEN_IDS as readonly string[]).includes(target)) setScreen(target as ScreenId);
      return;
    }
    if (screen === "face") await api.setupStep("profile", { status: "skipped", phase: "meet" });
    arrivedByBack.current = false;
    const index = SCREEN_IDS.indexOf(screen);
    const following = SCREEN_IDS[index + 1];
    // Once the owner exists, Back and Continue step over the create form.
    if (following === "owner" && !("done" in updated) && stepIsDone(updated, "owner")) setScreen("face");
    else if (following) setScreen(following);
  }

  async function defer() {
    const updated = await record(screen, "deferred");
    if (!updated) return;
    if (screen === "face") await api.setupStep("profile", { status: "skipped", phase: "meet" });
    arrivedByBack.current = false;
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
      const already = reason instanceof ApiError && reason.status === 409;
      const message = already ? "Home is already set up. Sign in instead." : reason instanceof Error && reason.message === SECRET_SERVER_TEXT ? SECRET_LENGTH_COPY : reason instanceof Error ? reason.message : "Home couldn't save your account. Check the name and PIN, then press Create owner account again.";
      setError(message);
      if (already) navigate("/sign-in", { replace: true });
      else throw reason;
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
    arrivedByBack.current = true;
    if (id === "computers") setScreen("welcome");
    if (id === "meet") setScreen("owner");
  }
  const back = () => {
    const index = SCREEN_IDS.indexOf(screen);
    if (index <= 0) return;
    arrivedByBack.current = true;
    const previous = SCREEN_IDS[index - 1]!;
    setScreen(previous === "owner" && state && stepIsDone(state, "owner") ? "plan" : previous);
  };

  function retryChecks() { arrivedByBack.current = false; setCheckError(false); setChecksRun((n) => n + 1); }

  if (loading) return null;
  if (!state) return <main><Card><CardHeader><CardTitle>Setup progress unavailable</CardTitle></CardHeader><CardContent><p role="alert">{error ?? "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."}</p><Button type="button" onClick={() => { setLoading(true); setError(null); void refresh().catch(() => setError("Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again.")).finally(() => setLoading(false)); }}>Try again</Button></CardContent></Card></main>;

  let body;
  switch (screen) {
    case "welcome": body = <div className="flex flex-col gap-2"><p className="text-base font-normal text-muted-foreground md:text-lg">Your chats, people, and memories stay on your computers. Home goes online only for downloads, updates, and searches you ask for.</p><a className="inline-flex min-h-12 max-w-full items-center whitespace-normal break-words text-base text-muted-foreground underline underline-offset-4 md:text-lg" href="/backups">Restoring a backup? Finish setup, then open Backups.</a></div>; break;
    case "before_start": body = <Accordion typography="body">{BEFORE_START_DETAILS.map((item) => <AccordionItem key={item.id} value={item.id}><AccordionTrigger>{item.title}</AccordionTrigger><AccordionContent><p>{item.detail}</p></AccordionContent></AccordionItem>)}</Accordion>; break;
    case "engine_location": body = renderSetupReviewScreen({ screen: "engine_location", engine, onEngineChange: setEngine, showTitle: false }); break;
    case "storage": body = <StorageStep split={engine === "another_computer"} value={storageChoice} onChange={(value, blocked) => { setStorageChoice(value); setStorageBlocked(blocked); }} />; break;
    case "checks": {
      const blocking = checkRows?.some((row) => row.state === "red") ?? false;
      const warnings = checkRows?.some((row) => row.state === "amber") ?? false;
      body = initialScreen === "checks" ? renderSetupReviewScreen({ screen: "checks", checkRows, checkError, checksFetching, showTitle: false, onRetryChecks: () => { setCheckError(false); setChecksFetching(true); void api.setupChecks().then((result) => { setCheckRows(result.rows); setState(result.state); setSearchCandidate(result.searchCandidate); }, () => setCheckError(true)).finally(() => setChecksFetching(false)); } }) : <div>
        <AsyncState data={checkRows} error={checkError} isFetching={checksFetching || (checkRows === null && !checkError)} onRetry={retryChecks} errorMessage="Home couldn't check these computers." loadingLabel="Checking your computers">
          {(rows) => <CheckGrid rows={rows} split={engine === "another_computer"} renderAction={(row) => row.action === "allow_tailnet" ? <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => void allowEngineTailnet()}>{row.actionLabel ?? "Allow"}</Button> : null} />}
        </AsyncState>
        {tailnetError ? <p role="alert">{tailnetError}</p> : null}
        {blocking ? <p>Fix what is marked Needs fixing, then press Try again.</p> : null}
        {warnings && !blocking ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { void record("checks", "deferred").then((updated) => { if (updated) setScreen("plan"); }); }}>Continue anyway</Button> : null}
      </div>;
      break;
    }
    case "plan": body = <><PlanStep onInstalled={() => { planInstalled.current = true; void next(); }} />{searchCandidate ? <Card><CardContent><p>Found a private search service on this computer.</p><Button type="button" variant="secondary" disabled={busy} onClick={() => void chooseSearchCandidate()}>Use it</Button></CardContent></Card> : null}{searchError ? <p role="alert">{searchError}</p> : null}</>; break;
    case "owner": body = <Card><CardContent><p>{OWNER_COPY}</p><NewPersonForm formRef={ownerFormRef} actorRole="owner" fixedRole="owner" onSubmit={async (values) => { await submitOwner(values.displayName, values.secret ?? ""); }} submitLabel="Create owner account" busy={busy} error={error} checkSecret hideSubmit /></CardContent></Card>; break;
    case "face": body = <Card><CardContent><p>Face data stays on this computer. You can turn on face greetings now or later in your profile.</p></CardContent></Card>; break;
    case "hello": body = <Card><CardContent><p>You can talk with Home as soon as setup is finished.</p></CardContent></Card>; break;
    case "backup": body = <Card><CardContent><p className="text-base text-muted-foreground md:text-lg">If this computer breaks, this key restores your Home on a new one.</p><Button type="button" variant="secondary" size="lg" disabled={!backupKey} onClick={() => void downloadEmergencyKit()}>Download</Button><Button type="button" variant="secondary" size="lg" disabled={!backupKey} onClick={() => void printEmergencyKit()}>Print</Button><Button type="button" variant="secondary" size="lg" disabled={!backupKey || busy} onClick={() => void confirmBackupKeySaved()}>I saved my backup key</Button>{backupKeyError ? <p role="alert">Home couldn't make your backup key. Press Download again. If it fails again, Home will show a fix under Home settings, Repairs.</p> : null}{backupSavedError ? <p role="alert">Home couldn't save that choice. Try again. If it fails again, Home will show a fix under Home settings, Repairs.</p> : null}</CardContent></Card>; break;
    case "done": body = <Card><CardContent>{engine === "another_computer" ? <><p>Pair the computer that runs the AI. You can also do this later in Home settings, Engines and AI.</p><EngineLinkCredentialSection /></> : null}<p>Start a chat, add people, or choose apps whenever you're ready.</p>{thingsLeftLine ? <p>{thingsLeftLine}. You'll find them in Home settings.</p> : null}{certificate === "error" ? <p role="alert">Home couldn't make the certificate for your other devices. Phones and tablets can still use Home from this computer's address for now. Open Home settings, Repairs to fix it.</p> : null}</CardContent></Card>; break;
  }

  if (SCREEN_IDS.indexOf(screen) > SCREEN_IDS.indexOf("plan")) body = <><InstallStrip detailsHref="/settings/home/ai" read={api.setupInstallStatus} />{body}</>;
  const phaseStep = PHASES.find((item) => item.id === phase)!.id;
  const currentPhaseIndex = phase === "meet" ? 1 : 0;
  const screenIndex = SCREEN_IDS.indexOf(screen);
  const submit = screen === "owner" ? submitOwner : screen === "done" ? finish : screen === "face" ? defer : next;
  const previewBanner = window.__setupPreview ? <SetupPreviewBar currentScreen={screenIndex + 1} onJump={(index) => setScreen(SCREEN_IDS[Math.max(0, Math.min(SCREEN_IDS.length - 1, index))]!)} /> : undefined;
  const art = SCREEN_ART[screen];
  return <Wizard steps={PHASES} currentStepId={phaseStep} completedCount={completedCount} onJumpTo={screen === "owner" ? () => ownerFormRef.current?.requestSubmit() : moveToPhase} onBack={screenIndex > 0 ? back : undefined} onNext={() => screen === "owner" ? ownerFormRef.current?.requestSubmit() : screen === "checks" && checkRows?.some((row) => row.state === "red") ? retryChecks() : void submit()} nextLabel={screen === "owner" ? "Create owner account" : screen === "welcome" ? "Set up my Home" : screen === "before_start" ? "I understand" : screen === "face" ? "Do this later" : screen === "done" ? "Open my Home" : screen === "checks" && checkRows?.some((row) => row.state === "red") ? "Try again" : "Continue"} nextDisabled={screen === "owner" ? busy : screen === "storage" ? storageBlocked : screen === "checks" && checksFetching} busy={busy || (screen === "done" && certificate === "loading")} layout="centered" stepKind="intro" stickyFooter={false} progress={{ current: currentPhaseIndex + 1, total: PHASES.length }} eyebrow={PHASES[currentPhaseIndex]!.title} heading={SCREEN_TITLE[screen]} description={SCREEN_DESCRIPTION[screen]} header={<img src={dark ? "/brand/maipai-home-logo-dark.png" : "/brand/maipai-home-logo-light.png"} alt="MaiPai Home" width={104} height={39} />} aside={art ? <img src={art} alt="" /> : undefined} banner={previewBanner}>{downloads.filter((job) => isVisibleModelDownload(job)).map((job) => <JobProgress key={job.id} {...modelDownloadProgress(job)} variant="compact" cancelable={job.actions?.includes("stop")} onCancel={job.actions?.includes("stop") ? () => { void api.stopJob(job.id); } : undefined} />)}{body}{error && screen !== "owner" ? <p role="alert">{error}</p> : null}</Wizard>;
}

function phaseFor(id: string): SetupState["phase"] {
  if (id === "done") return "done";
  if (["owner", "face", "profile", "hello", "backup_key"].includes(id)) return "meet";
  return "computers";
}
