import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LICENCE_ACK_SENTENCE } from "../../../../shared/licenceTerms";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { useNavigate } from "react-router-dom";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { Button } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Link } from "react-router-dom";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { CheckGrid, visibleCheckRows, type CheckGridRow } from "./CheckGrid";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@maipai/ui/src/dashboard/components/ui/accordion";
import { Field, FieldContent, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError } from "@/lib/api";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import { setupChecklistCountLine } from "@/shell/useSetupChecklist";
import { SetupPreviewBar } from "./preview/SetupPreviewBar";
import { useIsDark } from "@/shell/ThemeToggle";
import { InstallStrip } from "@/shell/InstallStrip";
import { PlanStep } from "./PlanStep";
import { HostTuneStep, useHostTuneSupported } from "./HostTuneStep";
import { CloseAppsStep, useCloseAppsQuestion } from "./CloseAppsStep";
import { WebSearchStep } from "./WebSearchStep";
import { StorageStep, type StorageChoice } from "./StorageStep";
import { NewPersonForm } from "@/apps/people/NewPersonForm";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
import type { SetupCodingView } from "@/lib/api";

const ErrorIcon = getIcon("circle-alert");

interface SetupWizardProps { onDone: () => void; initialScreen?: ScreenId }

declare global {
  interface Window { __setupPreview?: boolean }
}

const PHASES: WizardStep[] = [
  { id: "computers", title: "Your Home" },
  { id: "meet", title: "Your AI" },
];
// Steps older installs recorded that no screen shows any more.
const RETIRED_STEPS = new Set<string>(["away", "face", "profile", "hello"]);
const SCREEN_IDS = ["welcome", "before_start", "engine_location", "storage", "host_tune", "checks", "plan", "web_search", "owner", "coding_mode", "close_apps", "backup", "done"] as const;
type ScreenId = (typeof SCREEN_IDS)[number];
const SCREEN_TITLE: Record<ScreenId, string> = {
  welcome: "Welcome to MaiPai Home",
  before_start: "Before you start",
  engine_location: "How should Home run?",
  storage: "Choose where to store data",
  host_tune: "Tune this computer",
  checks: "Checking your computer",
  plan: "Your setup plan",
  web_search: "Turn on web search",
  owner: "Create your owner account",
  coding_mode: "Coding on this Home",
  close_apps: "Close apps for big jobs",
  backup: "Save your backup key",
  done: "You're all set",
};
/** One definition of the Checks wording: plural only when two computers are involved. */
export const checksTitle = (engine: string) => (engine === "another_computer" ? "Checking your computers" : SCREEN_TITLE.checks);
const checksSubject = (engine: string) => (engine === "another_computer" ? "these computers" : "this computer");
export const checksErrorMessage = (engine: string) => `Home couldn't check ${checksSubject(engine)}.`;
/** The plain outcome line shown under the results. */
export function checksSummary(rows: readonly CheckGridRow[]): string {
  const shown = visibleCheckRows(rows);
  const red = shown.filter((row) => row.state === "red").length;
  const amber = shown.filter((row) => row.state === "amber").length;
  if (red > 0) return `${red === 1 ? "1 thing needs" : `${red} things need`} fixing. Fix what is marked Needs fixing, then press Try again.`;
  if (amber > 0) return `${amber === 1 ? "1 thing" : `${amber} things`} to look at. You can continue, but ${amber === 1 ? "it" : "those parts"} may not work.`;
  return "Everything looks ready.";
}
const SCREEN_DESCRIPTION: Record<ScreenId, string> = {
  welcome: "Your family's private AI, in your own home.",
  before_start: "Home is built to protect your family and your data. Like any AI or online tool, it works best when you know a few things.",
  engine_location: "Choose one computer, or add a bigger one for the AI.",
  storage: "Keep the defaults or pick your own.",
  host_tune: "Optional. Skip it any time.",
  checks: "Home is checking that everything is ready.",
  plan: "Review the steps Home will complete.",
  web_search: "Optional. Skip it any time.",
  owner: "Create the account that manages this Home.",
  coding_mode: "Choose whether to set up Coding on this computer.",
  close_apps: "Optional. Not now is fine.",
  backup: "Save this key somewhere other than this computer.",
  done: "Your Home is ready to use.",
};
const SCREEN_ART: Partial<Record<ScreenId, string>> = {
  welcome: "/setup-art/welcome.webp",
  before_start: "/setup-art/before-you-start.webp",
  engine_location: "/setup-art/where.webp",
  storage: "/setup-art/storage.webp",
  plan: "/setup-art/plan.webp",
  host_tune: "/setup-art/tune.webp",
  web_search: "/setup-art/search.webp",
  owner: "/setup-art/owner.webp",
  coding_mode: "/setup-art/coding.webp",
  close_apps: "/setup-art/tune.webp",
  backup: "/setup-art/backup.webp",
  checks: "/setup-art/checking.webp",
  done: "/setup-art/done.webp",
};
const BEFORE_START_DETAILS = [
  { id: "ai", title: "AI can be wrong or say the wrong thing", detail: "Answers can be inaccurate, offensive, or harmful. They are not medical, legal, or professional advice, and you are responsible for how you use them." },
  { id: "content", title: "The AI decides what it will make", detail: "Home does not censor content in code. The AI model decides what it will answer or create, including pictures, videos, songs, and companion media. Home still applies account access, age and surface availability, and technical limits." },
  { id: "responsibility", title: "A little care goes a long way", detail: "When you make or share something with Home, please respect other people and their privacy. Make sure you have permission to use someone’s image, video, or voice, and the rights to any material you include. Be mindful of copyright and consent, follow the law, and use what you create kindly—don’t use it to bully, tease, embarrass, or hurt someone." },
  { id: "kids", title: "Kids may still see things they shouldn't", detail: "Child profiles start restricted, and parents choose what they can reach. No protection is perfect, so stay involved." },
  { id: "attachment", title: "People can grow attached to AI", detail: "It is easy to feel close to a chatbot or companion, so keep real relationships first and talk with children about it. In Home settings, under Users, you can turn off AI companions for one person or for the household." },
  { id: "internet", title: "Home goes online for you", detail: "Home fetches downloads, updates, and searches you ask for the way you would. Some sites limit, block, or disallow automated visits, so now and then a site may not work. " + LICENCE_ACK_SENTENCE },
];
const OWNER_COPY = "You manage this Home, its people, files, and backups. Nobody can remove the owner.";
const SECRET_SERVER_TEXT = "secret must be 4-128 characters";
const SECRET_LENGTH_COPY = "Use 4 to 128 characters for your PIN or password, then press Create owner account again.";
const stepIsDone = (state: SetupState, id: string) => state.steps.find((step) => step.id === id)?.status === "done";

export function renderSetupReviewScreen({ screen, engine = "this_computer", onEngineChange, readOnly = false, checkRows, checkError = false, checksFetching = false, onRetryChecks, showTitle = true }: {
  screen: "engine_location" | "storage" | "checks" | "plan";
  engine?: "this_computer" | "another_computer";
  onEngineChange?: (value: "this_computer" | "another_computer") => void;
  readOnly?: boolean;
  checkRows?: Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }> | null;
  checkError?: boolean;
  checksFetching?: boolean;
  onRetryChecks?: () => void;
  showTitle?: boolean;
}) {
  if (screen === "engine_location") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.engine_location}</CardTitle></CardHeader> : null}<CardContent><RadioGroup disabled={readOnly} value={engine} onValueChange={(v) => onEngineChange?.(v as typeof engine)}><FieldLabel htmlFor="engine-local"><Field orientation="horizontal"><RadioGroupItem value="this_computer" id="engine-local" /><FieldContent><span className="text-base font-medium md:text-lg">One computer</span><p className="text-base text-muted-foreground md:text-lg">Home and AI both run on this computer.</p></FieldContent></Field></FieldLabel><FieldLabel htmlFor="engine-remote"><Field orientation="horizontal"><RadioGroupItem value="another_computer" id="engine-remote" /><FieldContent><span className="text-base font-medium md:text-lg">Two computers</span><p className="text-base text-muted-foreground md:text-lg">Home runs on this computer. The AI runs on a bigger, more powerful computer on your network. You pair it on the last screen of setup.</p></FieldContent></Field></FieldLabel></RadioGroup></CardContent></Card>;
  if (screen === "storage") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.storage}</CardTitle><CardDescription>Home uses its ready-to-use default folder.</CardDescription></CardHeader> : null}<CardContent>{!showTitle ? <p>Home will use its default folder for AI models.</p> : null}</CardContent></Card>;
  if (screen === "plan") return <Card>{showTitle ? <CardHeader><CardTitle>{SCREEN_TITLE.plan}</CardTitle></CardHeader> : null}<CardContent><p>After setup, choose and download AI models in Home settings.</p></CardContent></Card>;
  return <div>{showTitle ? <h2 className="mb-4 text-lg font-medium">{checksTitle(engine)}</h2> : null}<AsyncState data={checkRows ?? null} error={checkError} isFetching={checksFetching} onRetry={onRetryChecks ?? (() => {})} errorMessage={`${checksErrorMessage(engine)} Refresh this page and try again.`} loadingLabel={checksTitle(engine)}>{(items) => <><CheckGrid rows={items} split={engine === "another_computer"} /><p className="mt-4 text-base md:text-lg">{checksSummary(items)}</p></>}</AsyncState></div>;
}

export function SetupWizard({ onDone, initialScreen }: SetupWizardProps) {
  const ownerFormRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const dark = useIsDark();
  const navigate = useNavigate();
  const [state, setState] = useState<SetupState | null>(null);
  const [screen, setScreen] = useState<ScreenId>(initialScreen ?? "welcome");
  const codingSetup = useQuery({ queryKey: ["setup-coding"], queryFn: api.setupCoding, enabled: screen === "coding_mode", refetchInterval: (query) => query.state.data?.pieces.some((piece) => piece.state === "installing") ? 2000 : false });
  const [codingBusy, setCodingBusy] = useState<"set_up" | "later" | "test" | "key" | null>(null);
  const [codingError, setCodingError] = useState<string | null>(null);
  const [codingKey, setCodingKey] = useState<{ secret: string; hint: string } | null>(null);
  const [codingKeyCopied, setCodingKeyCopied] = useState(false);
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
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [checkRows, setCheckRows] = useState<Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }> | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [checksFetching, setChecksFetching] = useState(false);
  const [checksRun, setChecksRun] = useState(0);
  const planInstalled = useRef(false);
  // The plan screen's footer Continue is blocked while "Install and continue"
  // is the way forward (PlanStep reports it); starts blocked so the loading
  // moment cannot be clicked through. Found while auditing the Mac Studio
  // install: Continue recorded the plan as deferred and started no download.
  const [planBlocksContinue, setPlanBlocksContinue] = useState(true);
  const [openThings, setOpenThings] = useState<number | null>(null);
  const [tailnetError, setTailnetError] = useState<string | null>(null);
  const [searchCandidate, setSearchCandidate] = useState<string | null>(null);
  const [searchNeeded, setSearchNeeded] = useState(false);
  const [searchCanContinue, setSearchCanContinue] = useState(true);
  const searchContinue = useRef<(() => Promise<void>) | null>(null);
  const [storageChoice, setStorageChoice] = useState<StorageChoice>({});
  const [storageBlocked, setStorageBlocked] = useState(false);
  // The optional "This computer" step shows only on a Mac that runs the AI itself.
  const hostTuneShown = useHostTuneSupported(engine === "this_computer");
  // The Close apps question shows once the owner exists, and only on a Mac used as a regular computer (MEM-SPACE-12).
  const closeAppsShown = useCloseAppsQuestion(engine === "this_computer" && (screen === "coding_mode" || screen === "close_apps") && Boolean(state && stepIsDone(state, "owner")));
  const codingReadyPieces = Boolean(codingSetup.data && codingSetup.data.pieces.length > 0 && codingSetup.data.pieces.every((piece) => piece.state === "installed"));
  const codingSetupStarted = Boolean(codingBusy === "set_up" || codingSetup.data?.pieces.some((piece) => piece.state === "installing"));
  const finishCodingChoice = () => setScreen(neighbour("coding_mode", 1) ?? "backup");
  const chooseCoding = async (choice: "set_up" | "later") => {
    setCodingBusy(choice); setCodingError(null);
    try { await api.chooseSetupCoding(choice); sessionStorage.setItem("maipai:setup-coding-mode-choice", choice === "later" ? "later" : "set_up"); await queryClient.invalidateQueries({ queryKey: ["setup-coding"] }); if (choice === "later") finishCodingChoice(); }
    catch (reason) { setCodingError(reason instanceof ApiError ? reason.message : "Home could not save this choice. Try again."); }
    finally { setCodingBusy(null); }
  };
  const runCodingTest = async () => {
    setCodingBusy("test"); setCodingError(null);
    try { await api.runCodingModeSelfTest(); await queryClient.invalidateQueries({ queryKey: ["setup-coding"] }); }
    catch (reason) { setCodingError(reason instanceof ApiError ? reason.message : "Home could not run the coding test. Try again."); }
    finally { setCodingBusy(null); }
  };
  const createCodingKey = async () => {
    setCodingBusy("key"); setCodingError(null);
    try { const result = await api.createApiKey({ name: "My coding tool", scopes: ["code"], expires_in_days: 90 }); setCodingKey({ secret: result.secret, hint: result.key.hint }); }
    catch (reason) { setCodingError(reason instanceof ApiError ? reason.message : "Home could not create your key. Try again."); }
    finally { setCodingBusy(null); }
  };
  const neighbour = (from: ScreenId, step: 1 | -1): ScreenId | undefined => {
    let index = SCREEN_IDS.indexOf(from) + step;
    if (SCREEN_IDS[index] === "host_tune" && !hostTuneShown) index += step;
    // The Web search screen shows only when Home's own search is not ready (SETUP-SEARCH-02).
    if (SCREEN_IDS[index] === "web_search" && !searchNeeded) index += step;
    if (SCREEN_IDS[index] === "close_apps" && !closeAppsShown) index += step;
    return SCREEN_IDS[index];
  };

  const rememberSearch = (result: { searchCandidate: string | null; searchNeeded?: boolean }) => { setSearchCandidate(result.searchCandidate); setSearchNeeded(result.searchNeeded === true); };

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
    const firstPending = result.steps.find((step) => !RETIRED_STEPS.has(step.id) && (step.status === "pending" || step.status === "running" || step.status === "failed"))?.id;
    // The common new-person profile flow is not built. The plan explicitly
    // removes screen 9 until it exists, so its server record is not a UI step.
    const ownerDone = stepIsDone(result, "owner");
    const disclosureSeen = sessionStorage.getItem("maipai:setup-before-start-read") === "true";
    const codingStepPresent = (result.steps as Array<{ id: string }>).some((step) => step.id === "coding_mode");
    const savedCodingChoice = sessionStorage.getItem("maipai:setup-coding-mode-choice");
    const resumeCoding = ownerDone && !codingStepPresent && firstPending === "backup_key" && savedCodingChoice !== "later" && savedCodingChoice !== "done";
    const next = !ownerDone && !disclosureSeen && firstPending !== "welcome" ? "before_start" : resumeCoding ? "coding_mode" : firstPending === "backup_key" ? "backup" : firstPending;
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
    setChecksFetching(true);
    void api.setupChecks().then((result) => {
      if (!active) return;
      setCheckRows(result.rows);
      setState(result.state);
      rememberSearch(result);
      setCheckError(false);
    }, () => { if (active) setCheckError(true); }).finally(() => { if (active) setChecksFetching(false); });
    return () => { active = false; };
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
    // The app cannot confirm the file was saved, so the click that starts the download unlocks Continue.
    setBackupDownloaded(true);
    void confirmBackupKeySaved();
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

  const phase = screen === "owner" || screen === "coding_mode" || screen === "close_apps" || screen === "backup" || screen === "done" ? "meet" : "computers";
  const completedCount = phase === "meet" ? 1 : 0;
  const thingsLeftLine = openThings === null ? null : setupChecklistCountLine(openThings);

  async function record(id: string, status: "done" | "skipped" | "deferred" = "done", extra: { models?: string; records?: string; engine?: { where: "this_computer" | "another_computer"; hardware: Record<string, unknown> } } = {}) {
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
    if (screen === "web_search") { await (searchContinue.current ?? (async () => { setScreen(neighbour(screen, 1) ?? "owner"); }))(); return; }
    if (screen === "host_tune") { setScreen(neighbour(screen, 1) ?? "checks"); return; }
    if (screen === "close_apps") { setScreen(neighbour(screen, 1) ?? "backup"); return; }
    const deferred = (["checks", "plan"].includes(stepId) && !(stepId === "plan" && planInstalled.current)) || (screen === "engine_location" && engine === "another_computer");
    // The models folder belongs to the engine computer on a split setup, so it is never sent.
    const folders = screen === "storage" ? { ...(engine === "this_computer" && storageChoice.models ? { models: storageChoice.models } : {}), ...(storageChoice.records ? { records: storageChoice.records } : {}) } : {};
    // Saying where the AI runs is what decides whether Home installs the
    // AI engine on this computer, so the choice itself is sent.
    const engineChoice = screen === "engine_location" ? { engine: { where: engine, hardware: state?.engine?.hardware ?? {} } } : {};
    // LICENCE-ACK-01: "I understand" on the Before you start list also accepts the licences named in its internet item.
    if (screen === "before_start") {
      try { await api.setupAcceptLicences(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Home couldn't save your acknowledgement. Press I understand again."); return; }
    }
    const updated = await record(stepId, deferred ? "deferred" : "done", { ...folders, ...engineChoice });
    if (!updated) return;
    if (screen === "before_start") {
      sessionStorage.setItem("maipai:setup-before-start-read", "true");
      const firstPending = updated.steps.find((step) => !RETIRED_STEPS.has(step.id) && (step.status === "pending" || step.status === "running" || step.status === "failed"))?.id;
      const target = firstPending === "backup_key" ? "backup" : firstPending;
      if (target && (SCREEN_IDS as readonly string[]).includes(target)) setScreen(target as ScreenId);
      return;
    }
    const following = neighbour(screen, 1);
    // Once the owner exists, Back and Continue step over the create form.
    if (following === "owner" && !("done" in updated) && stepIsDone(updated, "owner")) setScreen(stepIsDone(updated, "coding_mode") ? "backup" : "coding_mode");
    else if (following) setScreen(following);
  }

  async function submitOwner(name = ownerName, secret = ownerSecret) {
    if (!name.trim() || !secret) return;
    setBusy(true);
    setError(null);
    try {
      await api.setup(name.trim(), secret);
      const updated = await api.setupStep("owner", { status: "done", phase: "meet" });
      setState(updated);
      setScreen("coding_mode");
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
      const result = await api.setupChecks(); setCheckRows(result.rows); setState(result.state); rememberSearch(result);
    }
    catch (reason) { setTailnetError(reason instanceof Error ? reason.message : "Home couldn't allow Tailscale for the engine link. Sign in as an owner or admin, then try again."); }
    finally { setBusy(false); }
  }

  function moveToPhase(id: string) {
    if (id === "computers") setScreen("welcome");
    if (id === "meet") setScreen("owner");
  }
  const back = () => {
    const index = SCREEN_IDS.indexOf(screen);
    if (index <= 0) return;
    const previous = neighbour(screen, -1)!;
    setScreen(previous === "owner" && state && stepIsDone(state, "owner") ? "plan" : previous);
  };

  function retryChecks() { setCheckError(false); setChecksRun((n) => n + 1); }

  if (loading) return null;
  if (!state) return <main><Card><CardHeader><CardTitle>Setup progress unavailable</CardTitle></CardHeader><CardContent><Alert variant="destructive"><ErrorIcon /><AlertDescription>{error ?? "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."}</AlertDescription></Alert><Button type="button" onClick={() => { setLoading(true); setError(null); void refresh().catch(() => setError("Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again.")).finally(() => setLoading(false)); }}>Try again</Button></CardContent></Card></main>;

  let body;
  switch (screen) {
    case "welcome": body = <div className="flex flex-col gap-2"><p className="text-base font-normal text-muted-foreground md:text-lg">Your chats, people, and memories stay on your computers. Home goes online only for downloads, updates, and searches you ask for.</p><a className="inline-flex min-h-12 max-w-full items-center whitespace-normal break-words text-base text-muted-foreground underline underline-offset-4 md:text-lg" href="/backups">Restoring a backup? Finish setup, then open Backups.</a></div>; break;
    case "before_start": body = <Accordion typography="body">{BEFORE_START_DETAILS.map((item) => <AccordionItem key={item.id} value={item.id}><AccordionTrigger>{item.title}</AccordionTrigger><AccordionContent><p>{item.detail}</p></AccordionContent></AccordionItem>)}</Accordion>; break;
    case "engine_location": body = renderSetupReviewScreen({ screen: "engine_location", engine, onEngineChange: setEngine, showTitle: false }); break;
    case "storage": body = <StorageStep split={engine === "another_computer"} value={storageChoice} onChange={(value, blocked) => { setStorageChoice(value); setStorageBlocked(blocked); }} />; break;
    case "host_tune": body = <HostTuneStep onSkip={() => void next()} />; break;
    case "close_apps": body = <CloseAppsStep onDone={() => setScreen(neighbour("close_apps", 1) ?? "backup")} />; break;
    case "checks": {
      body = initialScreen === "checks" ? renderSetupReviewScreen({ screen: "checks", checkRows, checkError, checksFetching, showTitle: false, onRetryChecks: () => { setCheckError(false); setChecksFetching(true); void api.setupChecks().then((result) => { setCheckRows(result.rows); setState(result.state); rememberSearch(result); }, () => setCheckError(true)).finally(() => setChecksFetching(false)); } }) : <div>
        <AsyncState data={checkRows} error={checkError} isFetching={checksFetching || (checkRows === null && !checkError)} onRetry={retryChecks} errorMessage={checksErrorMessage(engine)} loadingLabel={checksTitle(engine)}>
          {(rows) => <><CheckGrid rows={rows} split={engine === "another_computer"} renderAction={(row) => row.action === "allow_tailnet" ? <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => void allowEngineTailnet()}>{row.actionLabel ?? "Allow"}</Button> : null} /><p className="mt-4 text-base md:text-lg">{checksSummary(rows)}</p></>}
        </AsyncState>
        {tailnetError ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{tailnetError}</AlertDescription></Alert> : null}
      </div>;
      break;
    }
    case "plan": body = <PlanStep onInstalled={() => { planInstalled.current = true; void next(); }} onReady={setPlanBlocksContinue} />; break;
    case "web_search": body = <WebSearchStep candidate={searchCandidate} continueRef={searchContinue} onCanContinue={setSearchCanContinue} onFinished={() => { setScreen(neighbour("web_search", 1) ?? "owner"); }} />; break;
    case "owner": body = <Card><CardContent><p>{OWNER_COPY}</p><NewPersonForm formRef={ownerFormRef} actorRole="owner" fixedRole="owner" onSubmit={async (values) => { await submitOwner(values.displayName, values.secret ?? ""); }} submitLabel="Create owner account" busy={busy} error={error} checkSecret hideSubmit /></CardContent></Card>; break;
    case "coding_mode": {
      const coding = codingSetup.data as SetupCodingView | undefined;
      const codingHome = typeof window === "undefined" ? "https://home.example.com" : window.location.origin.replace(/^http:/i, "https:");
      body = codingSetup.isPending && !coding ? <p role="status">Loading coding setup…</p> : codingSetup.isError && !coding ? <Card><CardContent><Alert variant="destructive"><AlertDescription>Home could not load coding setup. Refresh this page and try again.</AlertDescription></Alert><Button type="button" variant="outline" size="lg" onClick={() => void codingSetup.refetch()}>Try again</Button></CardContent></Card> : <div className="flex flex-col gap-4">
        <p className="text-base text-muted-foreground md:text-lg">Normal keeps chat and pictures running as usual.</p>
        <p className="text-base text-muted-foreground md:text-lg">Coding mode gives most of this computer's memory to one big coding model, which also answers chat, and pictures, videos and songs wait while it is on.</p>
        {coding ? <><ItemGroup variant="card" aria-label="Coding parts to install">{coding.pieces.map((piece) => <Item key={piece.id}><ItemContent><ItemTitle>{piece.label}</ItemTitle><ItemDescription>{piece.size_bytes == null ? "Size not reported" : `${(piece.size_bytes / 1024 ** 3).toFixed(1)} GB`} · {piece.state === "installed" ? "Installed" : piece.state === "installing" ? "Installing" : piece.state === "failed" ? "Needs attention" : "Not installed"}</ItemDescription></ItemContent><Badge variant={piece.state === "installed" ? "secondary" : "outline"}>{piece.state === "installed" ? "Ready" : piece.state === "installing" ? "Installing" : "To install"}</Badge></Item>)}</ItemGroup>
          <p>Total: {(coding.total_bytes / 1024 ** 3).toFixed(1)} GB</p>
          {coding.eligible_mode ? <div className="flex flex-wrap gap-2">{codingReadyPieces ? null : <Button type="button" size="lg" disabled={codingBusy !== null || codingSetupStarted} onClick={() => void chooseCoding("set_up")}>{codingBusy === "set_up" ? "Starting" : codingSetupStarted ? "Installing" : "Set up coding"}</Button>}<Button type="button" variant="outline" size="lg" disabled={codingBusy !== null} onClick={() => void chooseCoding("later")}>{codingBusy === "later" ? "Saving" : "Not now"}</Button></div> : <><p>This computer needs to be a Mac with 128 GB of memory for Coding mode. You can still use the standard coding setup.</p><Button type="button" size="lg" disabled={codingBusy !== null || codingSetupStarted} onClick={() => void chooseCoding("set_up")}>{codingBusy === "set_up" ? "Starting" : codingSetupStarted ? "Installing" : "Set up standard coding"}</Button><Button type="button" variant="outline" size="lg" disabled={codingBusy !== null} onClick={() => void chooseCoding("later")}>Not now</Button></>}
          {codingReadyPieces ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="lg" disabled={codingBusy !== null} onClick={() => void runCodingTest()}>{codingBusy === "test" ? "Running" : "Run the test"}</Button>{codingKey ? null : <Button type="button" variant="outline" size="lg" disabled={codingBusy !== null} onClick={() => void createCodingKey()}>{codingBusy === "key" ? "Creating" : "Create my key"}</Button>}</div> : null}
          {codingKey ? <div className="flex flex-col gap-3"><Label htmlFor="setup-coding-key">Your key. Save it now; Home will show it only once.</Label><div className="flex flex-wrap gap-2"><Input id="setup-coding-key" readOnly value={codingKey.secret} /><Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(codingKey.secret).then(() => setCodingKeyCopied(true), () => setCodingError("Copy is not available in this browser. Select the key and copy it.")); }}>{codingKeyCopied ? "Copied" : "Copy"}</Button></div><p>Home address: {codingHome}/code/v1</p><Collapsible><CollapsibleTrigger render={<Button type="button" variant="outline" />}>Setup lines for your tool</CollapsibleTrigger><CollapsibleContent><div className="flex flex-col gap-3 pt-3"><div className="flex flex-col gap-1"><Label>OpenCode · same key</Label><Input readOnly value={`OPENAI_BASE_URL=${codingHome}/code/v1 OPENAI_API_KEY=maipai_key_...${codingKey.hint} opencode`} /></div><div className="flex flex-col gap-1"><Label>Claude Code · same key</Label><Input readOnly value={`ANTHROPIC_BASE_URL=${codingHome}/code/v1 ANTHROPIC_API_KEY=maipai_key_...${codingKey.hint} claude`} /></div><div className="flex flex-col gap-1"><Label>OpenAI-compatible · same key</Label><Input readOnly value={`OPENAI_BASE_URL=${codingHome}/code/v1 OPENAI_API_KEY=maipai_key_...${codingKey.hint} MODEL=$(curl -s ${codingHome}/code/v1/models | jq -r '.data[0].id')`} /></div></div></CollapsibleContent></Collapsible></div> : null}
        </> : null}
        <ItemGroup variant="card" aria-label="Coding apps you install"><Item><ItemContent><ItemTitle>1. Install OpenCode on your computer</ItemTitle><ItemDescription><Link to="/docs/user/coding-mode#opencode">How</Link></ItemDescription></ItemContent></Item><Item><ItemContent><ItemTitle>2. Install Claude Code on your computer</ItemTitle><ItemDescription><Link to="/docs/user/coding-mode#claude-code">How</Link></ItemDescription></ItemContent></Item></ItemGroup>
        {codingReadyPieces ? <Button type="button" size="lg" onClick={() => { sessionStorage.setItem("maipai:setup-coding-mode-choice", "done"); finishCodingChoice(); }}>Finish</Button> : null}
        {codingError ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{codingError}</AlertDescription></Alert> : null}
      </div>;
      break;
    }
    case "backup": body = <Card><CardContent><p className="text-base text-muted-foreground md:text-lg">If this computer breaks, this key restores your Home on a new one.</p><Button type="button" variant="secondary" size="lg" disabled={!backupKey} onClick={() => void downloadEmergencyKit()}>Download</Button>{backupDownloaded ? null : <p className="text-base text-muted-foreground md:text-lg">Download your backup key to continue.</p>}{backupKeyError ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>Home couldn't make your backup key. Press Download again. If it fails again, Home will show a fix under Home settings, Repairs.</AlertDescription></Alert> : null}{backupSavedError ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>Home couldn't save that choice. Try again. If it fails again, Home will show a fix under Home settings, Repairs.</AlertDescription></Alert> : null}</CardContent></Card>; break;
    case "done": body = <Card><CardContent>{engine === "another_computer" ? <><p>Pair the computer that runs the AI. You can also do this later in Home settings, Engines and AI.</p><EngineLinkCredentialSection /></> : null}<p>You can talk with Home as soon as you open it. Start a chat, add people, or choose apps whenever you're ready. If the AI is still downloading, chat starts answering when the first model finishes. To have Home greet you by face, turn it on in your profile; face data stays on this computer.</p>{thingsLeftLine ? <p>{thingsLeftLine}. You'll find them in Home settings.</p> : null}{certificate === "error" ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>Home couldn't make the certificate for your other devices. Phones and tablets can still use Home from this computer's address for now. Open Home settings, Repairs to fix it.</AlertDescription></Alert> : null}</CardContent></Card>; break;
  }

  if (SCREEN_IDS.indexOf(screen) > SCREEN_IDS.indexOf("engine_location")) body = <>{body}<InstallStrip compact detailsHref={null} read={api.setupInstallStatus} retry={state && stepIsDone(state, "owner") ? api.installRetry : () => api.setupEngineInstall().then(() => api.setupInstall().catch(() => undefined))} /></>;
  const phaseStep = PHASES.find((item) => item.id === phase)!.id;
  const currentPhaseIndex = phase === "meet" ? 1 : 0;
  const screenIndex = SCREEN_IDS.indexOf(screen);
  const submit = screen === "owner" ? submitOwner : screen === "done" ? finish : next;
  const previewBanner = window.__setupPreview ? <SetupPreviewBar currentScreen={screenIndex + 1} onJump={(index) => setScreen(SCREEN_IDS[Math.max(0, Math.min(SCREEN_IDS.length - 1, index))]!)} /> : undefined;
  const art = SCREEN_ART[screen];
  return <Wizard steps={PHASES} currentStepId={phaseStep} completedCount={completedCount} onJumpTo={screen === "owner" ? () => ownerFormRef.current?.requestSubmit() : moveToPhase} onBack={screenIndex > 0 ? back : undefined} onNext={() => screen === "owner" ? ownerFormRef.current?.requestSubmit() : screen === "checks" && checkRows?.some((row) => row.state === "red") ? retryChecks() : void submit()} nextLabel={screen === "owner" ? "Create owner account" : screen === "welcome" ? "Set up my Home" : screen === "before_start" ? "I understand" : screen === "done" ? "Open my Home" : screen === "checks" && checkRows?.some((row) => row.state === "red") ? "Try again" : "Continue"} nextDisabled={screen === "coding_mode" || (screen === "owner" ? busy : screen === "storage" ? storageBlocked : screen === "plan" ? planBlocksContinue && !planInstalled.current && !stepIsDone(state, "plan") : screen === "backup" ? !backupDownloaded : screen === "web_search" ? !searchCanContinue : screen === "checks" && checksFetching)} busy={busy || (screen === "done" && certificate === "loading")} layout="centered" stepKind="intro" stickyFooter={false} progress={{ current: currentPhaseIndex + 1, total: PHASES.length }} eyebrow={PHASES[currentPhaseIndex]!.title} heading={screen === "checks" ? checksTitle(engine) : SCREEN_TITLE[screen]} description={SCREEN_DESCRIPTION[screen]} header={<img src={dark ? "/brand/maipai-home-logo-dark.png" : "/brand/maipai-home-logo-light.png"} alt="MaiPai Home" width={104} height={39} />} aside={art ? <img src={art} alt="" /> : undefined} banner={previewBanner}>{body}{error && screen !== "owner" ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}</Wizard>;
}

function phaseFor(id: string): SetupState["phase"] {
  if (id === "done") return "done";
  if (["owner", "coding_mode", "backup_key"].includes(id)) return "meet";
  return "computers";
}
