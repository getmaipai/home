import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogBody, DialogSection } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { CharacterTile } from "@maipai/ui/src/primitives/CharacterTile";
import { GenerationStage } from "@maipai/ui/src/elements/generation-stage";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type CompanionLook, type CompanionLookJob } from "@/lib/api";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";
import { DEFAULT_FRAME, PreviewControls, type PictureFrame } from "@/shell/pages/companionFlow/PreviewControls";

export const lookKey = (id: string) => ["companions", id, "look"] as const;
const running = (job: CompanionLookJob | undefined, jobId: string | null) => jobId !== null && (job === undefined || job.state === "queued" || job.state === "running");

/** Screen 1, Create Character. It reports the draft and whether it holds a picture so the dialog can ask keep or discard on close. */
export function CreateCharacterStep({ companionId, initialName, onDraft, onApproved }: {
  companionId: string | null; initialName: string;
  onDraft: (state: { id: string | null; pictures: number; name: string }) => void; onApproved: () => void;
}) {
  const client = useQueryClient();
  const [draftId, setDraftId] = useState<string | null>(companionId);
  const [name, setName] = useState(initialName);
  const [draftName, setDraftName] = useState(companionId ? initialName : "");
  const [mode, setMode] = useState<"describe" | "upload">("describe");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState("cartoon");
  const [customStyle, setCustomStyle] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [frame, setFrame] = useState<PictureFrame>(DEFAULT_FRAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creating = useRef<Promise<string> | null>(null);
  const seeded = useRef(false);
  const Sparkles = getIcon("sparkles"), Palette = getIcon("palette"), User = getIcon("user");

  const lookQuery = useQuery({ queryKey: draftId ? lookKey(draftId) : ["companions", "none", "look"], queryFn: () => api.companionLook(draftId!), enabled: draftId !== null, retry: false });
  const look: CompanionLook | undefined = lookQuery.data;
  // The tiles come from Home for the viewer's age band and need no draft, so they show at once.
  const stylesQuery = useQuery({ queryKey: ["companions", "look-styles"], queryFn: () => api.getCompanionLookStyles(), retry: false, staleTime: 60_000 });
  const jobQuery = useQuery<CompanionLookJob>({
    queryKey: [...lookKey(draftId ?? "none"), "job", jobId], queryFn: () => api.companionLookJob(draftId!, jobId!), enabled: draftId !== null && jobId !== null, retry: false,
    refetchInterval: (q) => running(q.state.data, jobId) ? 1500 : false,
  });
  const job = jobQuery.data;
  const generating = running(job, jobId);
  const locked = generating || busy;

  useEffect(() => { onDraft({ id: draftId, pictures: look?.versions.length ?? 0, name: draftName }); }, [draftId, look?.versions.length, draftName, onDraft]);
  // Reopening an existing companion starts from its current picture.
  useEffect(() => {
    if (seeded.current || !look || shownId !== null || !look.versions.length) return;
    seeded.current = true;
    const current = look.rest ?? look.versions[look.versions.length - 1]!.id;
    setSourceId(current); setShownId(current);
  }, [look, shownId]);
  useEffect(() => {
    if (!job || !jobId) return;
    if (job.state === "done") {
      const made = job.versions[job.versions.length - 1];
      if (made) { setSourceId(made.id); setShownId(made.id); setFrame(DEFAULT_FRAME); setRemoveBackground(false); }
      void client.invalidateQueries({ queryKey: lookKey(draftId!) }); setJobId(null);
    } else if (job.state === "failed") { setError(job.error ?? "The picture could not be made. Change the description and try again."); setJobId(null); }
    else if (job.state === "cancelled") setJobId(null);
  }, [job, jobId, draftId, client]);

  const styles = look?.styles ?? stylesQuery.data?.styles ?? [];
  const keep = look?.keep ?? stylesQuery.data?.keep;
  const tiles = mode === "upload" && keep ? [{ id: keep.id as string, label: keep.label, custom: false }, ...styles] : styles;
  const customSelected = style === "custom";
  const picture = look?.versions.find((v) => v.id === shownId) ?? null;
  const ready = name.trim().length > 0 && (mode === "describe" ? description.trim().length > 0 : file !== null) && (!customSelected || customStyle.trim().length > 0);
  const canGenerate = ready && !locked && (look?.can_generate ?? true);

  function chooseMode(next: string) {
    if (next !== "describe" && next !== "upload") return;
    setMode(next); setStyle(next === "upload" ? "keep" : "cartoon");
  }
  function ensureDraft(): Promise<string> {
    if (draftId) return Promise.resolve(draftId);
    creating.current ??= api.createCompanionDraft(name.trim()).then(({ id }) => { setDraftId(id); setDraftName(name.trim()); return id; }).finally(() => { creating.current = null; });
    return creating.current;
  }
  // The draft is made once the name is typed.
  function nameDone() { if (name.trim() && !draftId) void ensureDraft().catch((e: unknown) => setError(flowErrorText(e))); }
  async function generate() {
    setError(""); setBusy(true);
    try {
      const id = await ensureDraft();
      const custom = customSelected ? { custom_style: customStyle.trim() } : {};
      if (mode === "describe") setJobId((await api.generateCompanionLook(id, { prompt: description.trim(), style, ...custom, count: 1 })).job);
      else {
        const body = new FormData(); body.append("image", file!);
        const uploaded = await api.uploadCompanionLook(id, body);
        await client.invalidateQueries({ queryKey: lookKey(id) });
        if (style === "keep") { setSourceId(uploaded.id); setShownId(uploaded.id); setFrame(DEFAULT_FRAME); setRemoveBackground(false); }
        else setJobId((await api.restyleCompanionLook(id, { version_id: uploaded.id, style, ...custom })).job);
      }
    } catch (e) { setError(flowErrorText(e)); } finally { setBusy(false); }
  }
  async function prepare(nextRemove: boolean, nextFrame: PictureFrame) {
    if (!draftId || !sourceId) return;
    const before = { removeBackground, frame };
    setRemoveBackground(nextRemove); setFrame(nextFrame); setError("");
    const plain = !nextRemove && nextFrame.zoom === 1 && nextFrame.x === DEFAULT_FRAME.x && nextFrame.y === DEFAULT_FRAME.y;
    if (plain) { setShownId(sourceId); return; }
    setBusy(true);
    try {
      const made = await api.prepareCompanionLook(draftId, { version_id: sourceId, remove_background: nextRemove, ...(nextFrame.zoom !== 1 || nextFrame.x !== 0.5 || nextFrame.y !== 0.5 ? { frame: nextFrame } : {}) });
      await client.invalidateQueries({ queryKey: lookKey(draftId) }); setShownId(made.id);
    } catch (e) { setError(flowErrorText(e)); setRemoveBackground(before.removeBackground); setFrame(before.frame); } finally { setBusy(false); }
  }
  async function approve() {
    if (!draftId || !shownId) return;
    setError(""); setBusy(true);
    try {
      if (name.trim() && name.trim() !== draftName) { await api.updateCompanion(draftId, { name: name.trim() }); setDraftName(name.trim()); }
      await api.approveCompanionLook(draftId, shownId);
      await client.invalidateQueries({ queryKey: lookKey(draftId) }); onApproved();
    } catch (e) { setError(flowErrorText(e)); } finally { setBusy(false); }
  }
  async function stop() {
    if (!draftId || !jobId) return;
    try { await api.cancelCompanionLookJob(draftId, jobId); setJobId(null); } catch (e) { setError(flowErrorText(e)); }
  }

  return (
    <>
    <DialogBody columns="two">
      <div className="flex flex-col gap-6">
        <DialogSection title="Character name">
          <Input aria-label="Character name" shape="pill" placeholder="Enter character name" maxLength={40} value={name} disabled={locked}
            onChange={(e) => setName(e.target.value)} onBlur={nameDone} />
        </DialogSection>
        <DialogSection title="Start with">
          <ToggleGroup type="single" variant="segmented" fill value={mode} onValueChange={chooseMode} aria-label="Start with">
            <ToggleGroupItem value="describe">Describe</ToggleGroupItem>
            <ToggleGroupItem value="upload">Upload Photo</ToggleGroupItem>
          </ToggleGroup>
          {mode === "describe"
            ? <Textarea aria-label="Describe the character" shape="rounded" placeholder="Describe the character you want to create..." maxLength={600} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
            : <Input aria-label="Photo" type="file" shape="pill" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </DialogSection>
        <DialogSection title="Choose a style">
          {tiles.length ? <div className="grid grid-cols-3 gap-3">
            {tiles.map((tile) => <CharacterTile key={tile.id} variant="picture" name={tile.label} selected={style === tile.id}
              media={tile.custom ? <Palette className="size-6 text-muted-foreground" aria-hidden="true" /> : tile.id === "keep" ? <User className="size-6 text-muted-foreground" aria-hidden="true" /> : <Sparkles className="size-6 text-muted-foreground" aria-hidden="true" />}
              onSelect={() => { if (!locked) setStyle(tile.id); }} />)}
          </div> : <p className="text-sm text-muted-foreground">{stylesQuery.isError ? flowErrorText(stylesQuery.error) : lookQuery.isError ? flowErrorText(lookQuery.error) : "Loading the styles"}</p>}
          {customSelected ? <Input aria-label="Custom style" shape="pill" placeholder="Type a style, for example paper cut-out" maxLength={120} value={customStyle} disabled={locked} onChange={(e) => setCustomStyle(e.target.value)} /> : null}
        </DialogSection>
        <div className="flex flex-col gap-2">
          <Button shape="pill" width="full" disabled={!canGenerate} onClick={() => void generate()}><Sparkles aria-hidden="true" />Generate Character</Button>
          {look && !look.can_generate && look.generate_reason ? <p className="text-sm text-muted-foreground">{look.generate_reason}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
      <DialogSection title="Character Preview">
        <GenerationStage generating={generating} shape="panel" aspectRatio="1 / 1">
          {picture
            ? <img src={picture.url} alt={`${name.trim() || "Your character"}, preview`} draggable={false} className="absolute inset-0 size-full object-contain" />
            : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
              <User className="size-12" aria-hidden="true" />
              <p>{generating ? (job?.label ?? "Starting your character") : "Your character will appear here"}</p>
            </div>}
          {picture && generating ? <p className="absolute inset-x-0 bottom-3 text-center text-sm text-foreground">{job?.label ?? "Making your character"}</p> : null}
        </GenerationStage>
        <p className="text-sm text-muted-foreground">Change the description or style and generate again until you&apos;re happy with your character.</p>
        {generating ? <Button variant="outline" shape="pill" onClick={() => void stop()}>Stop</Button> : null}
        {picture ? <PreviewControls removeBackground={removeBackground} frame={frame} disabled={locked}
          onRemoveBackground={(value) => void prepare(value, frame)} onFrameChange={setFrame} onFrameCommit={(next) => void prepare(removeBackground, next)} /> : null}
        <Button shape="pill" width="full" disabled={!picture || locked} onClick={() => void approve()}>Approve &amp; Continue</Button>
      </DialogSection>
    </DialogBody>
    </>
  );
}
