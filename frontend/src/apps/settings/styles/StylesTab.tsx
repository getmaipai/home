// VIDEO-LORA-08 (settings-media 4.4 and 5): the Styles tab of Settings, Pictures, videos and music. The household's styles with who can use each (one click), the
// plain Adult label after the unlock, ONE kit lock row for every adult-only or unknown style (no name, count or size until the person's own passcode), the Browse styles
// and Add from a file buttons, a download's progress (the kit JobProgress, never a name), where styles come from (Hugging Face, Civitai off by default, the two
// credentials write-only) and Recently removed. The server redacts; this view only draws what it is sent. Words come from the spec card's copy (rule S5).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { useLockProof } from "@maipai/ui/src/elements/adult-lock";
import { LockedSettingRow } from "@maipai/ui/src/settings/LockedSettingRow";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import type { Card as SpecCard } from "@maipai/ui/src/settings/settingsAudience";
import type { Roster } from "@/lib/api";
import { downloadProgress } from "@/lib/downloadProgress";
import { StyleAddFile } from "@/apps/settings/styles/StyleAddFile";
import { StyleBrowser } from "@/apps/settings/styles/StyleBrowser";
import { StyleEditor } from "@/apps/settings/styles/StyleEditor";
import { stylesApi, type SourcesState, type StyleList, type StyleRow, type StyleWho } from "@/apps/settings/styles/stylesApi";
import { adultCheckLine, filePath, messageOf, sizeWords, StylePicture, stylesCopy, whatItIs } from "@/apps/settings/styles/stylesShared";

const DAY = 86_400_000;
/** A list answer as the view reads it: the rows, and whether the one lock row is needed. */
const normalised = (list: Partial<StyleList>): StyleList => ({ items: list.items ?? [], locked: list.locked === true });
type Panel = { kind: "browse" } | { kind: "add" } | { kind: "edit"; id: string };

export function StylesTab({ person, card, children }: { person: Roster; card?: SpecCard; children?: ReactNode }) {
  const copy = stylesCopy(card);
  const client = useQueryClient();
  const lock = useLockProof();
  // Which dialog is open lives in the router's state (never the URL, so an adult-only style's id is not kept in history). The unlock resets every query and the page
  // behind this view reloads, so a dialog held in component state would close the moment someone unlocks from inside it.
  const location = useLocation();
  const navigate = useNavigate();
  const panel = ((location.state as { stylesPanel?: Panel } | null)?.stylesPanel) ?? null;
  const showPanel = (next: Panel | null) => navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { ...(location.state as object | null), stylesPanel: next } });
  const browsing = panel?.kind === "browse";
  const adding = panel?.kind === "add";
  const editing = panel?.kind === "edit" ? panel.id : null;
  const setBrowsing = (on: boolean) => showPanel(on ? { kind: "browse" } : null);
  const setAdding = (on: boolean) => showPanel(on ? { kind: "add" } : null);
  const setEditing = (id: string | null) => showPanel(id ? { kind: "edit", id } : null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["styles"] }); };
  const list = useQuery({ queryKey: ["styles", "list"], queryFn: async () => normalised(await stylesApi.list()), retry: false });
  const sources = useQuery({ queryKey: ["style-sources"], queryFn: stylesApi.sources, retry: false });
  const installs = useQuery({ queryKey: ["style-installs"], queryFn: async () => ({ items: (await stylesApi.installs()).items ?? [] }), retry: false, refetchInterval: (q) => (q.state.data?.items.some((i) => i.state === "queued" || i.state === "running") ? 2000 : false) });
  const running = (installs.data?.items ?? []).filter((i) => i.state === "queued" || i.state === "running");
  const wasRunning = useRef(0);
  useEffect(() => { if (wasRunning.current > 0 && running.length === 0) refresh(); wasRunning.current = running.length; });

  const rows = list.data?.items ?? [];
  const editingRow = editing ? rows.find((r) => r.id === editing) ?? null : null;
  // "Already added, open it": the card behind the lock when the style is locked (the unlock comes first).
  const openStyle = (id: string | null) => {
    const found = id ? rows.find((r) => r.id === id) : undefined;
    if (found) setEditing(found.id); else { setBrowsing(false); if (!lock.unlocked) lock.requestUnlock(); else setProblem("That style is not in the list yet. Reload this page and look again."); }
  };

  async function setWho(row: StyleRow, who: StyleWho) {
    setProblem(null);
    if (who === "people") { setEditing(row.id); return; }
    try { await stylesApi.patch(row.id, { availability: { who } }); refresh(); }
    catch (e) { setProblem(messageOf(e, "Home could not change who can use that style. Try again.")); }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="styles-tab">
      <section aria-label="Styles" className="flex flex-col gap-4">
        {card?.description ? <p className="text-sm text-muted-foreground">{card.description}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setBrowsing(true)}>{copy.browse_button}</Button>
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>{copy.add_file_button}</Button>
        </div>
        <DownloadsNow jobs={running} />
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        <AsyncState data={list.data} error={list.isError} isFetching={list.isFetching} onRetry={() => void list.refetch()} errorMessage="Home could not load the styles. Check the Home connection, then reload this page." loadingLabel="Loading the styles">
          {(data) => (
            <>
              {data.items.length === 0 && !data.locked ? <p className="text-sm text-muted-foreground">{copy.empty}</p> : (
                <ItemGroup variant="card" aria-label="Styles in the library">
                  {data.items.map((row) => <StyleListRow key={row.id} row={row} onWho={(who) => void setWho(row, who)} onEdit={() => setEditing(row.id)} />)}
                  {data.locked ? <LockedSettingRow /> : null}
                </ItemGroup>
              )}
              <p className="text-sm text-muted-foreground">{lock.unlocked ? copy.unlocked_note : copy.locked_note}</p>
            </>
          )}
        </AsyncState>
      </section>
      <SourcesSection copy={copy} state={sources.data ?? null} onChanged={() => void client.invalidateQueries({ queryKey: ["style-sources"] })} />
      {children}
      <RemovedList copy={copy} onChanged={refresh} />
      {browsing ? <StyleBrowser person={person} civitaiOn={sources.data?.civitai?.on === true} onClose={() => setBrowsing(false)} onInstalled={() => { setBrowsing(false); void installs.refetch(); }} onOpenStyle={openStyle} /> : null}
      {adding ? <StyleAddFile onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} /> : null}
      {editingRow ? <StyleEditor key={editingRow.id} row={editingRow} person={person} onClose={() => setEditing(null)} onChanged={refresh} /> : null}
    </div>
  );
}

/** The running downloads, each the kit's JobProgress card with no name (an adult-only style is never named). */
function DownloadsNow({ jobs }: { jobs: Array<{ job: string; title: string; percent: number | null }> }) {
  return jobs.map((job) => <JobProgress key={job.job} {...downloadProgress({ title: job.title, state: "running", status: "Downloading and checking the file", percent: job.percent ?? undefined })} variant="full" />);
}

function StyleListRow({ row, onWho, onEdit }: { row: StyleRow; onWho: (who: StyleWho) => void; onEdit: () => void }) {
  const adult = row.audience === "adult-only";
  return (
    <>
    <Item>
      <div aria-hidden="true" className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted"><StylePicture path={filePath(row.preview_file_id)} proof={adult} /></div>
      <ItemContent>
        <ItemTitle>{row.name} {adult ? <Badge variant="destructive">Adults only</Badge> : null}</ItemTitle>
        <ItemDescription clamp={false}>{whatItIs(row)} · {sizeWords(row.file.bytes)}</ItemDescription>
        <ItemDescription clamp={false}>{row.needs_confirmation ? "Open it to read the licence first. " : ""}{adultCheckLine(row.adult_check)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select value={row.availability.who} onValueChange={(v) => onWho(v as StyleWho)}>
          <SelectTrigger aria-label={`Who can use ${row.name}`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="admins">Only admins</SelectItem><SelectItem value="adults">All adults</SelectItem><SelectItem value="people">Chosen people</SelectItem></SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={onEdit}>Edit</Button>
      </ItemActions>
    </Item>
    </>
  );
}

/** A write-only secret: it is never shown, only replaced or removed (the saved state says so). */
function SecretRow({ label, savedLine, emptyLine, placeholder, saved, onSave, onRemove, copy }: {
  label: string; savedLine: string; emptyLine: string; placeholder: string; saved: boolean; onSave: (value: string) => Promise<unknown>; onRemove: () => Promise<unknown>; copy: { replace: string; remove: string };
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<unknown>, fail: string) {
    setBusy(true); setError(null);
    try { await task(); setValue(""); setEditing(false); } catch (e) { setError(messageOf(e, fail)); } finally { setBusy(false); }
  }
  const showField = !saved || editing;
  return (
    <>
    <Item>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        <ItemDescription clamp={false}>{saved ? savedLine : emptyLine}</ItemDescription>
        {showField ? (
          <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) void run(() => onSave(value.trim()), "Home could not save that. Check it, then try again."); }}>
            <Input type="password" autoComplete="off" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            <Button type="submit" disabled={busy || !value.trim()}>Save</Button>
            {saved ? <Button type="button" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>Cancel</Button> : null}
          </form>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </ItemContent>
      {saved && !editing ? (
        <ItemActions>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(true)}>{copy.replace}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(onRemove, "Home could not remove it. Try again.")}>{copy.remove}</Button>
        </ItemActions>
      ) : null}
    </Item>
    </>
  );
}

function SourcesSection({ copy, state, onChanged }: { copy: ReturnType<typeof stylesCopy>; state: SourcesState | null; onChanged: () => void }) {
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const civitai = state?.civitai?.on === true;
  const after = async (task: Promise<unknown>) => { await task; onChanged(); };
  async function turn(on: boolean) {
    setError(null);
    try { await stylesApi.setCivitai(on); onChanged(); }
    catch (e) { setError(messageOf(e, "Home could not change that. Try again.")); }
  }
  return (
    <section aria-label={copy.sources_title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{copy.sources_title}</h2>
      <ItemGroup variant="card" aria-label={copy.sources_title}>
        <Item><ItemContent><ItemTitle>Hugging Face</ItemTitle><ItemDescription clamp={false}>{copy.huggingface_note}</ItemDescription></ItemContent></Item>
        <SecretRow label="Hugging Face token" saved={state?.huggingface?.token_saved === true} placeholder="hf_..." copy={{ replace: copy.civitai_key_replace, remove: copy.civitai_key_remove }}
          emptyLine="Optional. Paste a read token. Home keeps it private and never shows it again." savedLine="A token is saved. Home keeps it private and never shows it again."
          onSave={(v) => after(stylesApi.saveHuggingFaceToken(v))} onRemove={() => after(stylesApi.removeHuggingFaceToken())} />
        <Item>
          <ItemContent><ItemTitle>Civitai</ItemTitle><ItemDescription clamp={false}>{civitai ? "On. This computer contacts civitai.com when you search or install." : copy.civitai_off_note}</ItemDescription>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</ItemContent>
          <ItemActions><Switch checked={civitai} aria-label="Civitai" disabled={state === null} onCheckedChange={(on) => { if (on) setNotice(true); else void turn(false); }} /></ItemActions>
        </Item>
        {civitai ? (
          <SecretRow label="Civitai key" saved={state?.civitai?.key_saved === true} placeholder="Paste your Civitai key" copy={{ replace: copy.civitai_key_replace, remove: copy.civitai_key_remove }}
            emptyLine="Some downloads need a free Civitai key. Home keeps it private and never shows it again." savedLine="A key is saved. Home keeps it private and never shows it again."
            onSave={(v) => after(stylesApi.saveCivitaiKey(v))} onRemove={() => after(stylesApi.removeCivitaiKey())} />
        ) : null}
      </ItemGroup>
      <AlertDialog open={notice} onOpenChange={setNotice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.civitai_notice_title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.civitai_notice_body_1} {copy.civitai_notice_body_2}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.civitai_notice_cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void turn(true)}>{copy.civitai_notice_confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function RemovedList({ copy, onChanged }: { copy: ReturnType<typeof stylesCopy>; onChanged: () => void }) {
  const removed = useQuery({ queryKey: ["styles", "removed"], queryFn: async () => normalised(await stylesApi.list(true)), retry: false });
  const [problem, setProblem] = useState<string | null>(null);
  const items = removed.data?.items ?? [];
  if (!removed.data || (items.length === 0 && !removed.data.locked)) return null;
  const now = Date.now();
  return (
    <section aria-label={copy.removed_title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{copy.removed_title}</h2>
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      <ItemGroup variant="card" aria-label={copy.removed_title}>
        {items.map((row) => {
          const days = row.removed_at ? Math.max(0, Math.floor((now - Date.parse(row.removed_at)) / DAY)) : 0;
          const left = row.trash_until ? Math.max(0, Math.ceil((Date.parse(row.trash_until) - now) / DAY)) : 0;
          return (
            <Item key={row.id}>
              <ItemContent><ItemTitle>{row.name}</ItemTitle><ItemDescription clamp={false}>{copy.removed_line.replace("{days}", String(days)).replace("{left}", String(left))}</ItemDescription></ItemContent>
              <ItemActions><Button type="button" variant="outline" onClick={() => { setProblem(null); void stylesApi.restore(row.id).then(onChanged).catch((e: unknown) => setProblem(messageOf(e, "Home could not restore that style. Try again."))); }}>{copy.restore_button}</Button></ItemActions>
            </Item>
          );
        })}
        {removed.data.locked ? <LockedSettingRow /> : null}
      </ItemGroup>
    </section>
  );
}
