import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle, ItemSeparator } from "@maipai/ui/src/dashboard/components/ui/item";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { api, ApiError, type AdminApiKey, type CodingGrant, type CodingModeReadinessItemId, type CodingModeView, type CodingPiece, type PersonalApiKey, type PersonRosterEntry, type Roster } from "@/lib/api";
import codingModeReasons from "@maipai/spec/vocab/coding-mode-readiness-reasons.json";
import { downloadProgress } from "@/lib/downloadProgress";

const KEYS = ["coding.enabled", "coding.home_mode", "coding.paused", "coding.adults_by_default", "coding.max_streams_per_person", "coding.requests_per_minute_per_key", "coding.daily_tokens_per_person", "coding.keep_warm_minutes", "coding.thinking_budget", "coding.thinking_budget_ceiling", "coding.api.enabled", "coding.api.away"];
const codingKeysQuery = (personId?: string) => ["coding-api-keys", personId ?? "self"] as const;
const messageOf = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;
const sizeText = (bytes: number | null) => bytes == null ? "Size not reported" : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
const dateText = (date: string | null) => date ? new Date(date).toLocaleDateString() : "Never";
const timeText = (date: string | null) => date ? new Date(date).toLocaleString() : "Never";
const isAdult = (entry: PersonRosterEntry) => entry.age_band === "adult" || entry.role === "owner" || entry.role === "admin" || entry.role === "adult";
const isMinor = (entry: PersonRosterEntry) => entry.age_band === "child" || entry.age_band === "teen" || entry.role === "child" || entry.role === "teen";

/** Settings > Household > Coding. The settings rows stay on the shared SettingsRenderer and its spec descriptions. */
const SELF_TEST_WAIT_MS = 15 * 60_000;
/** The test is a full switch into Coding mode and back, so it runs for minutes after the request is accepted. */
export function selfTestState(data: CodingModeView | undefined, startedAt: number | null): { running: boolean; failure: string | null } {
  if (startedAt === null || !data) return { running: false, failure: null };
  const done = data.readiness.items.find((item) => item.id === "self_test")?.state === "done";
  const elapsed = Date.now() - startedAt;
  if (done) return { running: false, failure: null };
  if (data.state !== "switching" && data.reason && elapsed > 8_000) return { running: false, failure: data.reason };
  if (elapsed > SELF_TEST_WAIT_MS) return { running: false, failure: "The coding test is taking longer than expected. Check the Status page, then try again." };
  return { running: true, failure: null };
}

/** One plain sentence for what Home is doing right now, so an admin never has to guess from the dropdown. */
export function homeModeSentence(data: CodingModeView | undefined): string | null {
  if (!data) return null;
  if (data.state === "waiting") return "Coding mode will start when the pictures, videos and songs being made finish. New ones are held until then. Choose Normal to cancel.";
  if (data.state === "switching") return "Home is switching modes. This takes about a minute, and chat pauses briefly.";
  if (data.state === "failed" && data.reason) return `The last mode change did not finish: ${data.reason}`;
  if (data.mode === "coding") return "Coding mode is on. One large model answers chat, search and coding. Pictures, videos and songs wait until you switch back to Normal.";
  return "Normal mode is on. Chat, pictures, videos and songs run as usual.";
}

export function CodingAdminSettings() {
  const client = useQueryClient();
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people() });
  const grants = useQuery({ queryKey: ["coding-grants"], queryFn: () => api.grants() });
  const settings = useQuery({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household") });
  const [pending, setPending] = useState<Record<string, "install" | "remove">>({});
  const pieces = useQuery({ queryKey: ["coding-pieces"], queryFn: api.codingPieces, refetchIntervalInBackground: true, refetchInterval: (q) => q.state.data?.pieces.some((piece) => piece.state === "installing") || Object.keys(pending).length > 0 ? 2000 : false });
  const [testStartedAt, setTestStartedAt] = useState<number | null>(null);
  const mode = useQuery({ queryKey: ["coding-mode"], queryFn: api.codingMode, refetchIntervalInBackground: true, refetchInterval: (q) => (pieces.data?.pieces.some((piece) => piece.state === "installing") || selfTestState(q.state.data, testStartedAt).running || q.state.data?.state === "switching" || q.state.data?.state === "waiting" ? 2000 : false) });
  const selfTest = selfTestState(mode.data, testStartedAt);
  const homeModeValue = settings.data?.find((setting) => setting.key === "coding.home_mode")?.value;
  // A change in the Home mode dropdown starts a switch; look once, then the poll above follows it while it runs.
  useEffect(() => { void mode.refetch(); }, [homeModeValue]);
  // The poll is scheduled from the options of the render that follows the start, so ask once more after that render.
  useEffect(() => { if (testStartedAt !== null) void mode.refetch(); }, [testStartedAt]);
  const downloading = pieces.data?.pieces.filter((piece) => piece.state === "installing") ?? [];
  const pieceCard = (piece: CodingPiece) => <JobProgress key={piece.id} {...downloadProgress({ title: piece.label, state: "running", status: "Downloading and installing", percent: piece.percent ?? undefined })} variant="full" />;
  const downloadCards = downloading.map(pieceCard);
  const [pieceError, setPieceError] = useState<string | null>(null);
  const [modeActionBusy, setModeActionBusy] = useState<CodingModeReadinessItemId | null>(null);
  const [modeActionError, setModeActionError] = useState<string | null>(null);
  const [removePiece, setRemovePiece] = useState<CodingPiece | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const paused = settings.data?.find((setting) => setting.key === "coding.paused")?.value === true;
  const modeReason = mode.data?.readiness.first_unmet ? codingModeReasons[mode.data.readiness.first_unmet] : undefined;
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["coding-pieces"] }), client.invalidateQueries({ queryKey: ["coding-grants"] }), client.invalidateQueries({ queryKey: ["people"] })]);
  const refreshModeChecklist = () => Promise.all([mode.refetch(), pieces.refetch(), settings.refetch()]).then(() => undefined);
  const runModeAction = async (id: CodingModeReadinessItemId) => {
    setModeActionBusy(id); setModeActionError(null);
    try {
      if (id === "pieces") {
        for (const piece of (pieces.data?.pieces ?? []).filter((item) => item.state !== "installed" && item.can_install)) await api.installCodingPiece(piece.id);
      } else if (id === "self_test") { await api.runCodingModeSelfTest(); setTestStartedAt(Date.now()); }
      else if (id === "coding_enabled") await api.setSetting("household", "coding.enabled", true);
      await refreshModeChecklist();
    } catch (reason) {
      setModeActionError(messageOf(reason, id === "self_test" ? "Home could not run the coding test. Try again." : "Home could not update coding mode. Try again."));
      await refreshModeChecklist().catch(() => undefined);
    } finally { setModeActionBusy(null); }
  };
  const saveGrant = async (target: PersonRosterEntry, enabled: boolean) => {
    const existing = (grants.data ?? []).filter((grant) => grant.person === target.id && grant.action === "use:code" && !grant.deleted_at);
    const defaultAllowed = isAdult(target) && settings.data?.find((item) => item.key === "coding.adults_by_default")?.value !== false;
    const desired: CodingGrant["effect"] = enabled ? "allow" : "deny";
    if (enabled === defaultAllowed) {
      await Promise.all(existing.map((grant) => api.revokeGrant(grant.id)));
    } else {
      await Promise.all(existing.map((grant) => api.revokeGrant(grant.id)));
      await api.createGrant({ person: target.id, action: "use:code", effect: desired });
    }
    if (isMinor(target)) await api.setSetting(`person:${target.id}`, "coding.person.api_keys", enabled);
    await refresh();
  };
  const install = async (piece: CodingPiece) => {
    setPieceError(null);
    setPending((value) => ({ ...value, [piece.id]: "install" }));
    try { await api.installCodingPiece(piece.id); await refresh(); }
    catch (error) { setPieceError(messageOf(error, "Could not start this install.")); }
    finally { setPending((value) => { const next = { ...value }; delete next[piece.id]; return next; }); }
  };
  const remove = async (piece: CodingPiece) => {
    setPieceError(null);
    setPending((value) => ({ ...value, [piece.id]: "remove" }));
    try { await api.removeCodingPiece(piece.id); await refresh(); }
    catch (error) { setPieceError(messageOf(error, "Could not remove this piece.")); }
    finally { setPending((value) => { const next = { ...value }; delete next[piece.id]; return next; }); }
  };
  const roster = (people.data ?? []).filter((entry) => entry.role !== "guest").sort((a, b) => {
    const bandOrder = (entry: PersonRosterEntry) => isAdult(entry) ? 0 : entry.age_band === "teen" || entry.role === "teen" ? 1 : 2;
    return bandOrder(a) - bandOrder(b) || a.display_name.localeCompare(b.display_name);
  });
  const enabledValue = grants.data ?? [];
  return <div className="flex flex-col gap-4">
    <SettingsRenderer scope="household" scopeValue="household" honouredBy="home" only={["household.coding"]} includeKeys={["coding.enabled", "coding.home_mode"]} titleOverrides={{ "household.coding": "Coding and Home mode" }} rowExtras={{ "coding.home_mode": { lockedReason: mode.data && !mode.data.readiness.ready ? modeReason : undefined } }} />
    <Card><CardHeader><CardTitle>Home mode checklist</CardTitle><CardDescription>Finish these steps before you turn on Coding mode.</CardDescription></CardHeader><CardContent>
      {homeModeSentence(mode.data) ? <p role="status" className="text-sm">{homeModeSentence(mode.data)}</p> : null}
      <AsyncState data={mode.data?.readiness.items} error={mode.isError} isFetching={mode.isFetching} onRetry={() => void mode.refetch()} errorMessage="Could not load the Home mode checklist." loadingLabel="Loading Home mode checklist">
        {(rows) => <ItemGroup variant="card" aria-label="Home mode checklist">{rows.map((item, index) => <Item key={item.id}>
          <ItemContent><ItemTitle>{MODE_LABELS[item.id]} <Badge variant={item.state === "done" ? "secondary" : "outline"}>{(modeActionBusy === item.id || selfTest.running) && item.id === "self_test" ? "Running" : item.id === "pieces" && downloading.length > 0 ? "Installing" : item.id === "self_test" && selfTest.running ? "Running" : item.state === "done" ? "Ready" : item.state === "can_do" ? "Needs setup" : "Needs a step from you"}</Badge></ItemTitle>
            {item.state !== "done" ? <ItemDescription>{codingModeReasons[item.reason_key]}</ItemDescription> : null}
            {item.id === "self_test" && selfTest.running ? <ItemDescription>Home is loading the large model, checking it, and switching back. This takes a few minutes. You can leave this page.</ItemDescription> : null}
            {item.id === "self_test" && selfTest.failure ? <ItemDescription role="alert">{selfTest.failure}</ItemDescription> : null}
            {item.id === "pieces" ? downloadCards : null}
            {item.state === "manual" ? <ItemDescription><Link to={`/docs/user/coding-mode#${item.doc_anchor}`}>How</Link></ItemDescription> : null}
          </ItemContent>
          {item.state === "can_do" ? <ItemActions><Button type="button" variant="outline" disabled={modeActionBusy !== null || (item.id === "pieces" && downloading.length > 0) || (item.id === "self_test" && selfTest.running)} onClick={() => void runModeAction(item.id)}>{modeActionBusy === item.id ? item.id === "self_test" ? "Running" : "Working" : item.id === "pieces" && downloading.length > 0 ? "Installing" : item.id === "self_test" && selfTest.running ? "Running" : item.id === "pieces" ? "Install" : item.id === "self_test" ? "Run the test" : "Turn coding on"}</Button></ItemActions> : null}
          {index < rows.length - 1 ? <ItemSeparator variant="inset" /> : null}
        </Item>)}</ItemGroup>}
      </AsyncState>
      {modeActionError ? <p role="alert" className="text-sm text-destructive">{modeActionError}</p> : null}
    </CardContent></Card>
    <SettingsRenderer scope="household" scopeValue="household" honouredBy="home" only={["household.coding", "household.coding_people", "household.coding_limits"]} includeKeys={KEYS.filter((key) => key !== "coding.paused" && key !== "coding.enabled" && key !== "coding.home_mode")} titleOverrides={{ "household.coding": "More Coding settings" }} />
    <Card><CardHeader><CardTitle>Stop all coding now</CardTitle><CardDescription>Pause coding requests until you resume. This does not delete keys.</CardDescription></CardHeader><CardContent><Button type="button" variant={paused ? "default" : "destructive"} onClick={() => setPauseOpen(true)}>{paused ? "Resume coding" : "Stop all coding now"}</Button>{settings.isError ? <p role="alert" className="text-sm text-destructive">Could not load the pause setting.</p> : null}</CardContent></Card>
    <Card>
      <CardHeader><CardTitle>Who can code</CardTitle><CardDescription>Adults follow the household default. Teens and children need an admin grant.</CardDescription></CardHeader>
      <CardContent>
        <AsyncState data={people.data && grants.data && settings.data ? roster : undefined} error={people.isError || grants.isError || settings.isError} isFetching={people.isFetching || grants.isFetching || settings.isFetching} onRetry={() => { void people.refetch(); void grants.refetch(); void settings.refetch(); }} errorMessage="Could not load Coding access." loadingLabel="Loading Coding access">
          {(entries) => <ItemGroup variant="card" aria-label="People who can code">{entries.map((entry) => {
            const own = enabledValue.filter((grant) => grant.person === entry.id && grant.action === "use:code" && !grant.deleted_at);
            const effect = own.some((grant) => grant.effect === "deny") ? "deny" : own.some((grant) => grant.effect === "allow") ? "allow" : null;
            const on = effect ? effect === "allow" : isAdult(entry) && settings.data?.find((item) => item.key === "coding.adults_by_default")?.value !== false;
            return <PersonGrantRow key={entry.id} entry={entry} checked={on} onChange={(value) => saveGrant(entry, value).catch((error: unknown) => setPieceError(messageOf(error, "Could not change Coding access.")))} />;
          })}</ItemGroup>}
        </AsyncState>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>What Coding needs</CardTitle><CardDescription>Home downloads these parts to this computer. Home does not install a coding app.</CardDescription></CardHeader><CardContent>
      <AsyncState data={pieces.data} error={pieces.isError} isFetching={pieces.isFetching} onRetry={() => void pieces.refetch()} errorMessage="Could not load Coding setup." loadingLabel="Loading Coding setup">
        {(view) => view.pieces.length === 0 ? <p className="text-sm text-muted-foreground">Coding needs these pieces.</p> : <ItemGroup variant="card" aria-label="Coding pieces">{view.pieces.map((piece) => <Item key={piece.id}>
          <ItemContent><ItemTitle>{piece.label} <Badge variant={piece.state === "installed" ? "secondary" : piece.state === "failed" ? "destructive" : "outline"}>{piece.state === "installed" ? "Installed" : piece.state === "notInstalled" ? "Not installed" : piece.state === "installing" ? "Installing" : piece.state === "unsupported" ? "Not supported" : "Needs attention"}</Badge></ItemTitle><ItemDescription>{piece.summary} · {sizeText(piece.size_bytes)}{piece.state === "installing" ? ` · ${piece.percent ?? 0}%` : ""}</ItemDescription>{piece.state === "installing" ? pieceCard(piece) : null}{piece.failure ? <ItemDescription>{piece.failure}</ItemDescription> : null}{piece.remove_block && !piece.can_remove ? <ItemDescription>{piece.remove_block}</ItemDescription> : null}{piece.install_block && !piece.can_install ? <ItemDescription>{piece.install_block}</ItemDescription> : null}</ItemContent>
          <ItemActions><Button type="button" onClick={() => void install(piece)} disabled={!piece.can_install || piece.state === "installing" || pending[piece.id] === "install"}>{pending[piece.id] === "install" || piece.state === "installing" ? "Installing" : "Install"}</Button><Button type="button" variant="outline" disabled={!piece.can_remove || pending[piece.id] === "remove"} onClick={() => setRemovePiece(piece)}>{pending[piece.id] === "remove" ? "Removing" : "Remove"}</Button></ItemActions>
        </Item>)}</ItemGroup>}
      </AsyncState>
      <AlertDialog open={removePiece !== null} onOpenChange={(open) => { if (!open) setRemovePiece(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {removePiece?.label}?</AlertDialogTitle><AlertDialogDescription>This removes the piece from this computer. You can install it again later.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={() => { const pending = removePiece; setRemovePiece(null); if (pending) void remove(pending); }}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </CardContent></Card>
    {pieceError ? <p role="alert" className="text-sm text-destructive">{pieceError}</p> : null}
    {pieces.data?.message ? <Alert><AlertTitle>{pieces.data.stack === "unreachable" ? "Coding engine is not answering" : "Coding setup"}</AlertTitle><AlertDescription>{pieces.data.message}</AlertDescription></Alert> : null}
    <p className="text-sm text-muted-foreground">Chat always comes first. Coding waits or slows down, never chat. See what is running on the <Link to="/status" className="text-primary underline">Status page</Link>.</p>
    <AlertDialog open={pauseOpen} onOpenChange={setPauseOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{paused ? "Resume coding?" : "Stop all coding now?"}</AlertDialogTitle><AlertDialogDescription>{paused ? "People with access can use Coding again." : "Coding requests stop until you resume. Keys stay in place and can be used again later."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant={paused ? "default" : "destructive"} onClick={() => { const next = !paused; setPauseOpen(false); void api.setSetting("household", "coding.paused", next).then(() => client.invalidateQueries({ queryKey: ["settings-values", "household"] })).catch((error: unknown) => setPieceError(messageOf(error, "Could not change the pause setting."))); }}>{paused ? "Resume coding" : "Stop all coding"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

const MODE_LABELS: Record<CodingModeReadinessItemId, string> = {
  coding_enabled: "Coding is on",
  engine: "Coding engine",
  pieces: "Coding model files",
  hardware: "Computer hardware",
  memory: "Free memory",
  self_test: "Coding test",
  client: "Coding app",
  bench: "Speed check",
};

function PersonGrantRow({ entry, checked, onChange }: { entry: PersonRosterEntry; checked: boolean; onChange: (value: boolean) => void }) {
  const [grantOpen, setGrantOpen] = useState(false);
  const minor = isMinor(entry);
  return <><Item><ItemContent><ItemTitle>{entry.display_name}</ItemTitle><ItemDescription>{minor ? checked ? "Granted by an admin. Their protections stay on." : "Needs an admin grant. Their protections stay on." : "Adult"}</ItemDescription></ItemContent><ItemActions><Switch checked={checked} onCheckedChange={(value) => { if (minor && value) setGrantOpen(true); else onChange(Boolean(value)); }} aria-label={`Allow ${entry.display_name} to use Coding`} /></ItemActions></Item><AlertDialog open={grantOpen} onOpenChange={setGrantOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Let {entry.display_name} use Coding?</AlertDialogTitle><AlertDialogDescription>Their safety protections stay on. Their keys work only while Coding is on, and an admin can take back this grant at any time.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Not now</AlertDialogCancel><AlertDialogAction onClick={() => { setGrantOpen(false); onChange(true); }}>Grant Coding</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

/** Settings > My account > Coding. Secrets are held only in state while the copy-once dialog is open. */
export function CodingKeysSettings({ person }: { person: Pick<Roster, "id" | "role"> }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: codingKeysQuery(), queryFn: api.apiKeys });
  const access = useQuery({ queryKey: ["coding-access", person.id], queryFn: api.codingAccess });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const minor = person.role === "child" || person.role === "teen";
  const [expires, setExpires] = useState<7 | 30 | 90 | 365>(minor ? 30 : 90);
  const [created, setCreated] = useState<{ key: PersonalApiKey; secret: string } | null>(null);
  const [rename, setRename] = useState<PersonalApiKey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [revoke, setRevoke] = useState<PersonalApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: codingKeysQuery() });
  const home = typeof window === "undefined" ? "https://home.example.com" : window.location.origin.replace(/^http:/i, "https:");
  const create = async () => {
    setError(null);
    try { setCreated(await api.createApiKey({ name: name.trim(), scopes: ["code"], expires_in_days: expires })); setName(""); setCreateOpen(false); await refresh(); }
    catch (reason) { setError(messageOf(reason, "Could not create this key.")); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError("Copy is not available in this browser. Select the text and copy it."); } };
  const snippet = (tool: "OpenCode" | "Claude Code" | "OpenAI-compatible", secret: string) => tool === "OpenCode"
    ? `OPENAI_BASE_URL=${home}/code/v1 OPENAI_API_KEY=${secret} opencode`
    : tool === "Claude Code"
      ? `ANTHROPIC_BASE_URL=${home}/code/v1 ANTHROPIC_API_KEY=${secret} claude`
      : `OPENAI_BASE_URL=${home}/code/v1 OPENAI_API_KEY=${secret} MODEL=$(curl -s ${home}/code/v1/models | jq -r '.data[0].id')`;
  return <div className="flex flex-col gap-4">
    <Card><CardHeader><CardTitle>Your Coding keys</CardTitle><CardDescription>A key lets a coding tool on your computer use Home's model. If an admin turns Coding off, your key stops working.</CardDescription></CardHeader><CardContent>
      <div className="flex flex-col gap-3">{access.data?.can_create ? <Button type="button" onClick={() => { setError(null); setCreateOpen(true); }}>Create key</Button> : access.data ? <p className="text-sm text-muted-foreground">You cannot make a new key with your current Coding access.</p> : null}
        <AsyncState data={query.data?.keys.filter((key) => key.scopes.includes("code"))} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage="Could not load your keys." loadingLabel="Loading your keys">
          {(keys) => keys.length === 0 ? <p className="text-sm text-muted-foreground">You have no Coding keys yet.</p> : <Table aria-label="Your Coding keys"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Scope</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Expires</TableHead><TableHead>Hint</TableHead><TableHead>Last used</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{keys.map((key) => <TableRow key={key.id}><TableCell>{key.name}</TableCell><TableCell>Coding</TableCell><TableCell><div className="flex flex-col items-start gap-1"><Badge variant={key.status === "active" ? "secondary" : "outline"}>{key.status}</Badge>{key.suspended_reason ? <span className="text-sm text-muted-foreground">{key.suspended_reason}</span> : null}</div></TableCell><TableCell>{dateText(key.created_at)}</TableCell><TableCell>{dateText(key.expires_at)}</TableCell><TableCell>•••• {key.hint}</TableCell><TableCell>{key.last_used_at ? `${timeText(key.last_used_at)} · ${key.last_used_from?.place === "away" ? "Away" : "Home network"}` : "Never"}</TableCell><TableCell><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setRename(key); setRenameValue(key.name); }}>Rename</Button><Button type="button" variant="destructive" onClick={() => setRevoke(key)}>Revoke</Button></div></TableCell></TableRow>)}</TableBody></Table>}
        </AsyncState>
      </div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Connect a coding tool</CardTitle><CardDescription>Home installs no coding tool.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">Home address: {home}/code/v1. Get the model name from GET /code/v1/models. Only use tools you trust with your key.</p>{query.data?.keys.some((key) => key.scopes.includes("code")) ? <Collapsible><CollapsibleTrigger render={<Button type="button" variant="outline" />}>Setup lines for your tool</CollapsibleTrigger><CollapsibleContent><div className="flex flex-col gap-3 pt-3">{(["OpenCode", "Claude Code", "OpenAI-compatible"] as const).map((tool) => <div key={tool} className="flex flex-col gap-1"><Label>{tool} · same key</Label><Input readOnly value={snippet(tool, `maipai_key_...${query.data?.keys.find((key) => key.scopes.includes("code"))?.hint ?? "abcd"}`)} aria-label={`${tool} setup line, key masked`} /></div>)}</div></CollapsibleContent></Collapsible> : null}</div></CardContent></Card>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setName(""); setCreateOpen(open); }}><DialogContent><DialogHeader><DialogTitle>Create a Coding key</DialogTitle><DialogDescription>Anyone with this key can use Coding as you. If an admin turns Coding off, this key stops working.</DialogDescription></DialogHeader><div className="flex flex-col gap-3"><Label htmlFor="coding-key-name">Name</Label><Input id="coding-key-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="My laptop" maxLength={60} /><Label htmlFor="coding-key-expiry">Expires</Label><Select value={String(expires)} onValueChange={(value) => setExpires(Number(value) as 7 | 30 | 90 | 365)}><SelectTrigger id="coding-key-expiry"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem>{minor ? null : <><SelectItem value="90">90 days</SelectItem><SelectItem value="365">1 year</SelectItem></>}</SelectContent></Select></div><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="button" disabled={!name.trim()} onClick={() => void create()}>Create key</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={created !== null} onOpenChange={(open) => { if (!open) setCreated(null); }}><DialogContent><DialogHeader><DialogTitle>Your key is ready</DialogTitle><DialogDescription>Copy it now. You will not see it again. Anyone with this key can use Coding as you.</DialogDescription></DialogHeader>{created ? <div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">This key is shown once.</p><div className="flex gap-2"><Input readOnly value={created.secret} aria-label="New Coding key" /><Button type="button" variant="outline" onClick={() => void copy(created.secret)}>{copied ? "Copied" : "Copy"}</Button></div><p className="text-sm">This is the only key. The tool lines below use this same key.</p><Collapsible><CollapsibleTrigger render={<Button type="button" variant="outline" />}>Setup lines for your tool</CollapsibleTrigger><CollapsibleContent><div className="flex flex-col gap-3 pt-3">{(["OpenCode", "Claude Code", "OpenAI-compatible"] as const).map((tool) => <div key={tool} className="flex flex-col gap-1"><Label>{tool} · same key</Label><div className="flex gap-2"><Input readOnly value={snippet(tool, created.secret)} aria-label={`${tool} setup line`} /><Button type="button" variant="outline" onClick={() => void copy(snippet(tool, created.secret))}>Copy</Button></div></div>)}</div></CollapsibleContent></Collapsible></div> : null}<DialogFooter><Button type="button" onClick={() => setCreated(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={rename !== null} onOpenChange={(open) => { if (!open) setRename(null); }}><DialogContent><DialogHeader><DialogTitle>Rename key</DialogTitle></DialogHeader><Label htmlFor="coding-key-rename">Name</Label><Input id="coding-key-rename" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /><DialogFooter><Button type="button" variant="outline" onClick={() => setRename(null)}>Cancel</Button><Button type="button" disabled={!renameValue.trim()} onClick={() => { if (rename) void api.renameApiKey(rename.id, renameValue.trim()).then(() => { setRename(null); return refresh(); }).catch((reason: unknown) => setError(messageOf(reason, "Could not rename this key."))); }}>Save</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={revoke !== null} onOpenChange={(open) => { if (!open) setRevoke(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke this key?</AlertDialogTitle><AlertDialogDescription>Tools using it will no longer connect to Home.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep key</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const pending = revoke; setRevoke(null); if (pending) void api.revokeApiKey(pending.id).then(refresh).catch((reason: unknown) => setError(messageOf(reason, "Could not revoke this key."))); }}>Revoke</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

/** Admin view of one person's Coding keys. The admin route omits names, hosts and use details. */
export function AdminCodingAccessRow({ personId, personName }: { personId: string; personName: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-coding-keys", personId], queryFn: () => api.adminApiKeys(personId) });
  const [selected, setSelected] = useState<AdminApiKey | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = Array.isArray(query.data?.keys) ? query.data.keys.filter((key) => key.scopes.includes("code")) : [];
  const live = keys.filter((key) => key.status !== "revoked" && !key.revoked_at);
  const reload = () => client.invalidateQueries({ queryKey: ["admin-coding-keys", personId] });
  const revokeKey = async (key: AdminApiKey) => { setSelected(null); setError(null); try { await api.adminRevokeApiKey(personId, key.id); await reload(); } catch (e) { setError(messageOf(e, "Could not revoke this key.")); } };
  const revokeEveryKey = async () => { setRevokeAll(false); setError(null); try { await api.adminRevokeAllApiKeys(personId); await reload(); } catch (e) { setError(messageOf(e, "Could not revoke all keys.")); } };
  return <section aria-label={`${personName} Coding access`} className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Coding access</h3>{live.length > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => setRevokeAll(true)}>Revoke all</Button> : null}</div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading keys</p> : query.isError ? <p className="text-sm text-destructive">Could not load Coding access.</p> : live.length === 0 ? <p className="text-sm text-muted-foreground">No Coding keys</p> : <ItemGroup variant="card" aria-label={`${personName} Coding keys`}>{live.map((key) => <Item key={key.id}><ItemContent><ItemTitle>Coding key <Badge variant={key.status === "active" ? "secondary" : "outline"}>{key.status}</Badge></ItemTitle><ItemDescription>Created {dateText(key.created_at)} · Expires {dateText(key.expires_at)} · Hint •••• {key.hint ?? "Unavailable"}</ItemDescription></ItemContent><ItemActions><Button type="button" size="sm" variant="outline" onClick={() => setSelected(key)}>Revoke</Button></ItemActions></Item>)}</ItemGroup>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <AlertDialog open={selected !== null || revokeAll} onOpenChange={(open) => { if (!open) { setSelected(null); setRevokeAll(false); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{revokeAll ? `Revoke all Coding keys for ${personName}?` : "Revoke this Coding key?"}</AlertDialogTitle><AlertDialogDescription>That key will no longer connect to Home.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (revokeAll) void revokeEveryKey(); else if (selected) void revokeKey(selected); }}>Revoke</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
