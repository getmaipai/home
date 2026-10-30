import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogBody, DialogFooter, DialogSection } from "@maipai/ui/src/ui/dialog";
import { Separator } from "@maipai/ui/src/ui/separator";
import { CharacterTile } from "@maipai/ui/src/primitives/CharacterTile";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { GenerationStage } from "@maipai/ui/src/elements/generation-stage";
import { StackedAlphaVideo } from "@maipai/ui/src/elements/stacked-alpha-video";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type CompanionStateRow, type CompanionStateUrls } from "@/lib/api";
import { useCompanionStates } from "@/shell/pages/useCompanionStates";
import { useClipPreview } from "@/shell/pages/companionFlow/useClipPreview";
import { lookKey } from "@/shell/pages/companionFlow/CreateCharacterStep";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";
import { useSheetWait } from "@/shell/pages/companionFlow/useSheetWait";
import { KeyframeEditor } from "@/shell/pages/companionFlow/KeyframeEditor";
import { MAKING_BACK_LINE, useMakingAvailability, useMakingRecovery } from "@/apps/chat/useMakingAvailability";

const keyframeSrc = (row: CompanionStateRow) => row.keyframe ? `${row.keyframe.url}${row.keyframe.edited_at ? `?v=${encodeURIComponent(row.keyframe.edited_at)}` : ""}` : null;
const made = (row: CompanionStateRow) => row.approved !== null;

/** The words on one tile: where that animation stands, in the order a person cares about. */
export function tileWord(row: CompanionStateRow): "Making" | "Waiting its turn" | "Out of date" | "Needs another try" | "Ready" | "No animation yet" {
  if (row.busy) return "Making";
  if (row.status === "waiting") return "Waiting its turn";
  if (made(row) && row.clip_out_of_date) return "Out of date";
  if (made(row)) return "Ready";
  if (row.status === "Needs another try") return "Needs another try";
  return "No animation yet";
}

/** The selected animation's looping clip. Under reduced motion, or when the clip cannot play, its still shows instead. */
function ClipPlayer({ urls, label }: { urls: CompanionStateUrls; label: string }) {
  const preview = useClipPreview(urls, label);
  return (
    <>
      {preview.failed || preview.reduced
        ? <img src={urls.still} alt={`${label} still`} draggable={false} className="min-h-0 w-full flex-1 object-contain" />
        : <StackedAlphaVideo src={preview.source} loop label={preview.label} onError={preview.onError} />}
      {preview.failed ? <p className="text-center text-xs text-muted-foreground">Preview not available in this browser.</p> : null}
      {preview.reduced ? <Button variant="outline" shape="pill" onClick={preview.play}>Play</Button> : null}
    </>
  );
}

/** Screen 2, Animate Character: thirteen animations, four required and nine optional, each with an editable keyframe. */
export function AnimateStep({ companionId, name, sheetJob = null, autoMake = false, onBack, onContinue }: { companionId: string; name: string; sheetJob?: string | null; autoMake?: boolean; onBack: () => void; onContinue: () => void }) {
  const states = useCompanionStates(companionId, true);
  // ENGINE-STATUS-MEDIA-01: animations need the video engine; a keyframe needs the picture engine. Each control waits for its own.
  const clips = useMakingAvailability("video"), pictures = useMakingAvailability("image");
  const reasonId = useId();
  const look = useQuery({ queryKey: lookKey(companionId), queryFn: () => api.companionLook(companionId), retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const Back = getIcon("arrow-left"), Next = getIcon("arrow-right"), Sparkles = getIcon("sparkles"), Pencil = getIcon("pencil"), Spinner = getIcon("loader");

  const rows = states.data?.states ?? [];
  const required = rows.filter((row) => row.required), optional = rows.filter((row) => !row.required);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const rest = look.data?.versions.find((v) => v.id === look.data?.rest) ?? look.data?.versions[look.data.versions.length - 1] ?? null;
  const portrait = rest?.url ?? null;
  const sheet = useSheetWait(companionId, sheetJob, rest?.id ?? null);
  const picturing = states.data?.busy ?? null;
  const rowBusy = rows.some((row) => row.busy || row.status === "waiting");
  const running = states.running || sheet.waiting || picturing !== null || rowBusy || states.data?.run != null;
  useMakingRecovery(clips, running, MAKING_BACK_LINE.animation);
  const pausedLine = clips.reason ?? pictures.reason;
  const missingRequired = required.filter((row) => !made(row)).map((row) => row.id);
  const pending = useMemo(() => optional.filter((row) => ticked.has(row.id) && !made(row)).map((row) => row.id), [optional, ticked]);
  const allTicked = optional.length > 0 && optional.every((row) => ticked.has(row.id));
  const label = name.trim() || "Your character";
  const progress = states.run?.percent ?? states.data?.run?.percent ?? 0;
  // What the buttons say while work is under way: the step in plain words, never just a greyed label.
  const doing = sheet.waiting || picturing?.kind === "sheet" ? "Drawing your character..."
    : picturing ? `${picturing.label}...`
    : running ? `${states.run?.label ?? states.data?.run?.label ?? "Making animations"}... ${progress}%` : "";

  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  // Which Generate button started the work, so only that one reads as busy; the others stay as they are, disabled.
  const [group, setGroup] = useState<"required" | "optional" | "one" | null>(null);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { if (!running) { setGroup(null); setRequested(new Set()); } }, [running]);
  const generate = (ids: string[], from: "required" | "optional" | "one") => { setGroup(from); setRequested(new Set(ids)); void states.start(() => api.generateCompanionStates(companionId, { states: ids, count: 1 })); };
  const stop = () => void states.stop();
  // Once the character is ready, the four required animations start by themselves, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoMake || autoStarted.current || clips.disabled || !states.data?.sheet_ready || running || missingRequired.length === 0 || states.error) return;
    autoStarted.current = true; generate(missingRequired, "required");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states.data?.sheet_ready, running, missingRequired.length, clips.disabled]);
  const toggle = (id: string, on: boolean) => setTicked((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const tile = (row: CompanionStateRow) => {
    const base = tileWord(row), word = running && requested.has(row.id) && !made(row) && base === "No animation yet" ? "Waiting its turn" : base, src = keyframeSrc(row) ?? portrait;
    return {
      name: row.label, selected: selectedId === row.id, onSelect: () => setSelectedId(row.id),
      media: row.approved ? (reducedMotion ? <img src={row.approved.urls.still} alt="" draggable={false} className="size-full object-cover" /> : <StackedAlphaVideo key={row.approved.take_id} src={row.approved.urls.h264} loop label={`${row.label} animation`} />) : src ? <img src={src} alt="" draggable={false} className={`size-full object-cover ${row.keyframe ? "" : "opacity-40"}`} /> : undefined,
      line: <span className="text-xs">{word}</span>,
      status: word === "Making" ? <Progress mode="determinate" value={progress} label={`${row.label} progress`} /> : undefined,
    };
  };
  const errorLine = sheet.message || states.error || (states.query.isError ? flowErrorText(states.query.error) : "");
  const generating = running || selected?.busy === true;
  const previewImage = selected ? (keyframeSrc(selected) ?? portrait) : portrait;

  return (
    <>
    <DialogBody columns="two">
      <DialogSection title="Preview">
        <GenerationStage generating={generating} shape="panel" frame="strong" transparency="checker" aspectRatio="1 / 1" caption={selected ? `${label} · ${selected.label}` : `${label} · Character`}>
          {selected?.approved
            ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><ClipPlayer key={selected.approved.take_id} urls={selected.approved.urls} label={`${label} ${selected.label}`} /></div>
            : previewImage ? <img src={previewImage} alt={`${label}, ${selected ? `${selected.label} keyframe` : "portrait"}`} draggable={false} className="absolute inset-0 size-full object-contain" /> : null}
        </GenerationStage>
        <div className="flex flex-wrap gap-3">
          <Button shape="pill" disabled={!selected || running || clips.disabled} aria-describedby={clips.reason ? reasonId : undefined} title={clips.reason ?? undefined} onClick={() => selected && generate([selected.id], "one")}><Sparkles aria-hidden="true" />Make another</Button>
          <Button variant="outline" shape="pill" disabled={!selected || running || pictures.disabled} aria-describedby={pictures.reason ? reasonId : undefined} title={pictures.reason ?? undefined} onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit keyframe</Button>
        </div>
        {selected ? <p className="text-sm text-muted-foreground">{selected.when_it_plays}</p> : null}
        {pausedLine ? <p id={reasonId} role="status" className="text-sm text-muted-foreground">{pausedLine}</p> : null}
      </DialogSection>
      <div className="flex flex-col gap-6">
        {sheet.waiting || picturing ? <div role="status" className="flex flex-col gap-2"><p className="text-sm text-foreground">{sheet.waiting || picturing?.kind === "sheet" ? "Drawing your character from the sides and with its mouth open, so every animation matches. This takes a few minutes, and your animations start by themselves when it is done." : `${picturing?.label ?? "Making a picture"} for your animations...`}</p><Progress mode="determinate" value={sheet.waiting ? sheet.percent : picturing?.percent ?? 0} label="Progress" /></div> : null}
        {errorLine ? <p role="alert" className="text-sm text-destructive">{errorLine}</p> : null}
        {sheet.failed ? <Button variant="outline" shape="pill" onClick={() => void sheet.retry()}>Try again</Button> : null}
        <DialogSection title="Required" aside={`${required.length || 4} animations · Always included`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {required.map((row) => <CharacterTile key={row.id} variant="animation" locked {...tile(row)} />)}
          </div>
          <Button shape="pill" width="full" disabled={running || clips.disabled || missingRequired.length === 0} aria-describedby={clips.reason ? reasonId : undefined} title={clips.reason ?? undefined} onClick={() => generate(missingRequired, "required")}>{group === "required" ? <Spinner className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{group === "required" ? doing : "Generate Required"}</Button>
          {group === "required" ? <Button variant="outline" shape="pill" width="full" onClick={stop}>Stop</Button> : null}
        </DialogSection>
        <Separator />
        <DialogSection title="Optional" aside={<Button variant="link" size="sm" disabled={running} onClick={() => setTicked(allTicked ? new Set() : new Set(optional.map((row) => row.id)))}>{allTicked ? "Clear All" : "Select All"}</Button>}>
          <p className="text-sm text-muted-foreground">{`${optional.length || 9} animations · Select the ones you want`}</p>
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
            {optional.map((row) => <CharacterTile key={row.id} variant="animation" checked={ticked.has(row.id)} onCheckedChange={(on) => toggle(row.id, on)} {...tile(row)} />)}
          </div>
          <Button variant="secondary" shape="pill" width="full" disabled={running || clips.disabled || pending.length === 0} aria-describedby={clips.reason ? reasonId : undefined} title={clips.reason ?? undefined} onClick={() => generate(pending, "optional")}>{group === "optional" ? doing : `Generate Optional (${pending.length})`}</Button>
          {group === "optional" ? <Button variant="outline" shape="pill" width="full" onClick={stop}>Stop</Button> : null}
        </DialogSection>
        {states.data && !states.data.sheet_ready && !errorLine ? <p className="text-sm text-muted-foreground">Finish your character on the first screen before making animations.</p> : null}
      </div>
    </DialogBody>
    <DialogFooter align="between">
      <Button variant="outline" shape="pill" onClick={onBack}><Back aria-hidden="true" />Back</Button>
      <Button shape="pill" disabled={required.length === 0 || missingRequired.length > 0} onClick={onContinue}>Continue<Next aria-hidden="true" /></Button>
    </DialogFooter>
    {selected ? <KeyframeEditor key={selected.id} companionId={companionId} row={selected} open={editing} onOpenChange={setEditing} /> : null}
    </>
  );
}
