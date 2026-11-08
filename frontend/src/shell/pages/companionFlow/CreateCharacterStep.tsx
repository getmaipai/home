import { i18n } from "@lingui/core";
import { useContext, useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogBody, DialogSection } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { CharacterTile } from "@maipai/ui/src/primitives/CharacterTile";
import { GenerationStage } from "@maipai/ui/src/elements/generation-stage";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type CompanionLook, type CompanionLookJob } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { useFillCutOff } from "@/lib/imaging/useFillCutOff";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";
import { DraggablePicture } from "@/shell/pages/companionFlow/DraggablePicture";
import { DEFAULT_FRAME, type PictureFrame } from "@/shell/pages/companionFlow/PreviewControls";
import { MAKING_BACK_LINE, useMakingAvailability, useMakingRecovery } from "@/apps/chat/useMakingAvailability";

export const lookKey = (id: string) => ["companions", id, "look"] as const;
const running = (job: CompanionLookJob | undefined, jobId: string | null) => jobId !== null && (job === undefined || job.state === "queued" || job.state === "running");

/** Screen 1, Create Character. It reports the draft and whether it holds a picture so the dialog can ask keep or discard on close. */
export function CreateCharacterStep({ creating, companionId, initialName, onDraft, onApproved }: {
  creating: MutableRefObject<Promise<string> | null>; companionId: string | null; initialName: string;
  onDraft: (state: { id: string | null; pictures: number; name: string }) => void; onApproved: (sheetJob: string | null) => void;
}) {
  const client = useQueryClient();
  const viewer = useContext(WakeWordPersonContext);
  // ENGINE-STATUS-MEDIA-01: every control here that asks the picture engine for work waits while it cannot take any.
  const making = useMakingAvailability("image");
  const reasonId = useId();
  const [draftId, setDraftId] = useState<string | null>(companionId);
  const [name, setName] = useState(initialName);
  const [basedKind, setBasedKind] = useState<"none" | "household_member" | "real_person">("none");
  const [basedPersonId, setBasedPersonId] = useState("");
  const [basedName, setBasedName] = useState("");
  const [draftName, setDraftName] = useState(companionId ? initialName : "");
  const [mode, setMode] = useState<"describe" | "upload">("describe");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState("cartoon");
  const [customStyle, setCustomStyle] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [frame, setFrame] = useState<PictureFrame>(DEFAULT_FRAME);
  // The placement already drawn into the shown picture; the live drag moves only by the difference.
  const [baked, setBaked] = useState<PictureFrame>(DEFAULT_FRAME);
  const [busyKind, setBusyKind] = useState<"generate" | "upload" | "prepare" | "complete" | "approve" | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const placing = useRef<{ timer: ReturnType<typeof setTimeout> | null; seq: number }>({ timer: null, seq: 0 });
  const seeded = useRef(false);
  const Sparkles = getIcon("sparkles"), Palette = getIcon("palette"), User = getIcon("user"), Spinner = getIcon("loader");

  const lookQuery = useQuery({ queryKey: draftId ? lookKey(draftId) : ["companions", "none", "look"], queryFn: () => api.companionLook(draftId!), enabled: draftId !== null, retry: false });
  const look: CompanionLook | undefined = lookQuery.data;
  // The tiles come from Home for the viewer's age band and need no draft, so they show at once.
  const stylesQuery = useQuery({ queryKey: ["companions", "look-styles"], queryFn: () => api.getCompanionLookStyles(), retry: false, staleTime: 60_000 });
  const peopleQuery = useQuery({ queryKey: ["people"], queryFn: api.people, retry: false, staleTime: 60_000, enabled: !companionId });
  const jobQuery = useQuery<CompanionLookJob>({
    queryKey: [...lookKey(draftId ?? "none"), "job", jobId], queryFn: () => api.companionLookJob(draftId!, jobId!), enabled: draftId !== null && jobId !== null, retry: false,
    refetchInterval: (q) => running(q.state.data, jobId) ? 1500 : false,
  });
  const job = jobQuery.data;
  const generating = running(job, jobId);
  useMakingRecovery(making, generating, MAKING_BACK_LINE.picture);
  const busy = busyKind !== null;
  const viewerBand = (viewer as (typeof viewer & { age_band?: string }) | null)?.age_band;
  const adultViewer = viewerBand ? viewerBand === "adult" : ["owner", "admin", "adult"].includes(viewer?.role ?? "");
  const basedOn = basedKind === "household_member"
    ? { kind: basedKind, person_id: basedPersonId || null, name: null }
    : basedKind === "real_person" ? { kind: basedKind, person_id: null, name: basedName.trim() || null } : { kind: "none" as const, person_id: null, name: null };
  const locked = generating || busy;
  // Moving the character stays possible while an earlier placement is being made; only the newest one is shown.
  const placeLocked = generating || (busy && busyKind !== "prepare");
  const makingCharacter = generating || busyKind === "generate" || busyKind === "complete";
  const preparingPhoto = busyKind === "upload";

  useEffect(() => { onDraft({ id: draftId, pictures: look?.versions.length ?? 0, name: draftName }); }, [draftId, look?.versions.length, draftName, onDraft]);
  // Reopening an existing companion starts from its current picture.
  useEffect(() => {
    if (seeded.current || !look || shownId !== null || !look.versions.length) return;
    seeded.current = true;
    const current = look.rest ?? look.versions[look.versions.length - 1]!.id;
    choose(current);
  }, [look, shownId]);
  useEffect(() => () => { if (placing.current.timer) clearTimeout(placing.current.timer); }, []);
  // A chosen photo shows as a small thumbnail beside its file name.
  useEffect(() => {
    if (!file) { setThumb(null); return; }
    const url = URL.createObjectURL(file); setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!job || !jobId) return;
    if (job.state === "done") {
      const made = job.versions[job.versions.length - 1];
      if (made) choose(made.id);
      void client.invalidateQueries({ queryKey: lookKey(draftId!) }); setJobId(null);
    } else if (job.state === "failed") { const text = job.error ?? i18n._({ id: "The picture could not be made. Change the description and try again.", message: "The picture could not be made. Change the description and try again." }); setError(text); setPreviewError(text); setJobId(null); }
    else if (job.state === "cancelled") setJobId(null);
  }, [job, jobId, draftId, client]);

  const styles = look?.styles ?? stylesQuery.data?.styles ?? [];
  const keep = look?.keep ?? stylesQuery.data?.keep;
  const tiles = mode === "upload" && keep ? [{ id: keep.id as string, label: keep.label, custom: false }, ...styles] : styles;
  const customSelected = style === "custom";
  const picture = look?.versions.find((v) => v.id === shownId) ?? null;
  const ready = name.trim().length > 0 && (mode === "describe" ? description.trim().length > 0 : file !== null) && (!customSelected || customStyle.trim().length > 0);
  const canGenerate = ready && !locked && !making.disabled && (look?.can_generate ?? true);

  // A picture that is cut off at an edge has the missing parts drawn in, once, without asking.
  useFillCutOff(picture, { skip: locked || making.disabled || (picture?.id === look?.rest && look?.sheet != null), fill: () => void complete() });
  /** A new picture (made, uploaded or reopened) starts centred; any pending move for the old one is dropped. */
  function choose(id: string) {
    if (placing.current.timer) { clearTimeout(placing.current.timer); placing.current.timer = null; }
    placing.current.seq++;
    setSourceId(id); setShownId(id); setFrame(DEFAULT_FRAME); setBaked(DEFAULT_FRAME);
  }
  /** Choosing Keep as is again shows the photo as it was uploaded. */
  function chooseStyle(id: string) {
    setStyle(id);
    if (id === "keep" && mode === "upload" && uploadedId) choose(uploadedId);
  }
  // Choosing Upload Photo opens the file browser at once: the click that chose it is the one that opens it.
  const fileInput = useRef<HTMLInputElement>(null);
  const [openPicker, setOpenPicker] = useState(false);
  useEffect(() => { if (openPicker && mode === "upload") { fileInput.current?.click(); setOpenPicker(false); } }, [openPicker, mode]);
  function chooseMode(next: string) {
    if (next !== "describe" && next !== "upload") return;
    setMode(next); setStyle(next === "upload" ? "keep" : "cartoon");
    if (next === "upload" && !file) setOpenPicker(true);
  }
  function ensureDraft(): Promise<string> {
    if (draftId) return Promise.resolve(draftId);
    const create = api.createCompanion({ name: name.trim(), formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", status: "draft", based_on: basedOn, life: { enabled: true, seed: "" } });
    creating.current ??= create.then(({ id }) => { setDraftId(id); setDraftName(name.trim()); return id; }).finally(() => { creating.current = null; });
    return creating.current;
  }
  // The draft is made once the name is typed.
  function nameDone() {
    if (name.trim() && !draftId) void ensureDraft().then(() => maybeUpload(file), (e: unknown) => setError(flowErrorText(e)));
    else maybeUpload(file);
  }
  const uploadedFor = useRef<File | null>(null);
  /** A chosen photo goes up at once (once the name is typed) and shows on the right as it is; a style other than Keep as is is applied by Generate. */
  function maybeUpload(chosen: File | null) {
    if (!chosen || !name.trim() || uploadedFor.current === chosen || making.disabled) return;
    uploadedFor.current = chosen; void uploadPhoto(chosen);
  }
  // Picking a photo never waits on the engine; a photo chosen while pictures are paused goes up when they are back.
  useEffect(() => { if (!making.disabled) maybeUpload(file); }, [making.disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  async function uploadPhoto(chosen: File) {
    setError(""); setPreviewError(""); setBusyKind("upload");
    try {
      const id = await ensureDraft();
      const body = new FormData(); body.append("image", chosen);
      const uploaded = await api.uploadCompanionLook(id, body);
      await client.invalidateQueries({ queryKey: lookKey(id) });
      setUploadedId(uploaded.id); choose(uploaded.id);
    } catch (e) { uploadedFor.current = null; setError(flowErrorText(e)); } finally { setBusyKind(null); }
  }
  async function generate() {
    setError(""); setPreviewError(""); setBusyKind("generate");
    try {
      const id = await ensureDraft();
      const custom = customSelected ? { custom_style: customStyle.trim() } : {};
      if (mode === "describe") setJobId((await api.generateCompanionLook(id, { prompt: description.trim(), style, ...custom, count: 1 })).job);
      else {
        let sourceVersion = uploadedId;
        if (!sourceVersion) {
          const body = new FormData(); body.append("image", file!);
          sourceVersion = (await api.uploadCompanionLook(id, body)).id; setUploadedId(sourceVersion);
          await client.invalidateQueries({ queryKey: lookKey(id) });
        }
        if (style === "keep") choose(sourceVersion);
        else setJobId((await api.restyleCompanionLook(id, { version_id: sourceVersion, style, ...custom })).job);
      }
    } catch (e) { setError(flowErrorText(e)); } finally { setBusyKind(null); }
  }
  /** The person moved or zoomed the character: show it at once, and ask Home for the placed picture 400 ms after the last change. */
  function place(next: PictureFrame) {
    if (!draftId || !sourceId) return;
    setFrame(next);
    if (placing.current.timer) clearTimeout(placing.current.timer);
    placing.current.timer = setTimeout(() => { placing.current.timer = null; void prepare(next); }, 400);
  }
  async function prepare(next: PictureFrame) {
    if (!draftId || !sourceId) return;
    const seq = ++placing.current.seq;
    if (next.zoom === DEFAULT_FRAME.zoom && next.x === DEFAULT_FRAME.x && next.y === DEFAULT_FRAME.y) { setShownId(sourceId); setBaked(DEFAULT_FRAME); return; }
    setPreviewError(""); setBusyKind("prepare");
    try {
      const made = await api.prepareCompanionLook(draftId, { version_id: sourceId, remove_background: true, frame: next });
      await client.invalidateQueries({ queryKey: lookKey(draftId) });
      if (seq === placing.current.seq) { setShownId(made.id); setBaked(next); }
    } catch (e) { if (seq === placing.current.seq) { setPreviewError(flowErrorText(e)); setFrame(baked); } } finally { if (seq === placing.current.seq) setBusyKind(null); }
  }
  async function complete() {
    if (!draftId || !shownId) return;
    setPreviewError(""); setBusyKind("complete");
    try { setJobId((await api.completeCompanionLook(draftId, shownId)).job); }
    catch (e) {
      setPreviewError(flowErrorText(e));
      if (e instanceof ApiError && e.status === 409) await client.invalidateQueries({ queryKey: lookKey(draftId) });
    } finally { setBusyKind(null); }
  }
  async function approve() {
    if (!draftId || !shownId) return;
    setPreviewError(""); setBusyKind("approve");
    try {
      if (name.trim() && name.trim() !== draftName) { await api.updateCompanion(draftId, { name: name.trim() }); setDraftName(name.trim()); }
      const { job: sheetJob } = await api.approveCompanionLook(draftId, shownId);
      await client.invalidateQueries({ queryKey: lookKey(draftId) }); onApproved(sheetJob);
    } catch (e) { setPreviewError(flowErrorText(e)); } finally { setBusyKind(null); }
  }
  async function stop() {
    if (!draftId || !jobId) return;
    try { await api.cancelCompanionLookJob(draftId, jobId); setJobId(null); } catch (e) { setPreviewError(flowErrorText(e)); }
  }

  return (
    <>
    <DialogBody columns="three">
      <div className="flex flex-col gap-6">
        {!companionId ? <DialogSection title={i18n._({ id: "Based on", message: "Based on" })}>
          <Select value={basedKind} onValueChange={(value) => { if (value === "none" || value === "household_member" || value === "real_person") setBasedKind(value); }}>
            <SelectTrigger shape="pill" width="full" aria-label={i18n._({ id: "Based on", message: "Based on" })}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{i18n._({ id: "Nobody", message: "Nobody" })}</SelectItem>
              <SelectItem value="household_member">{i18n._({ id: "A household member", message: "A household member" })}</SelectItem>
              {adultViewer ? <SelectItem value="real_person">{i18n._({ id: "A real person", message: "A real person" })}</SelectItem> : null}
            </SelectContent>
          </Select>
          {basedKind === "household_member" ? <Select value={basedPersonId} onValueChange={setBasedPersonId}>
            <SelectTrigger shape="pill" width="full" aria-label={i18n._({ id: "Household member", message: "Household member" })}><SelectValue placeholder={i18n._({ id: "Choose a person", message: "Choose a person" })} /></SelectTrigger>
            <SelectContent>{(peopleQuery.data ?? []).map((person) => <SelectItem key={person.id} value={person.id}>{person.display_name}</SelectItem>)}</SelectContent>
          </Select> : null}
          {basedKind === "real_person" ? <Input aria-label={i18n._({ id: "Real person name", message: "Real person name" })} shape="pill" maxLength={120} value={basedName} onChange={(event) => setBasedName(event.target.value)} placeholder={i18n._({ id: "Enter a real person's name", message: "Enter a real person's name" })} /> : null}
          {peopleQuery.isError ? <p role="alert" className="text-sm text-destructive">{flowErrorText(peopleQuery.error)}</p> : null}
        </DialogSection> : null}
        <DialogSection title={i18n._({ id: "Character name", message: "Character name" })}>
          <Input aria-label={i18n._({ id: "Character name", message: "Character name" })} shape="pill" placeholder={i18n._({ id: "Enter character name", message: "Enter character name" })} maxLength={40} value={name} disabled={locked}
            onChange={(e) => setName(e.target.value)} onBlur={nameDone} />
        </DialogSection>
        <DialogSection title={i18n._({ id: "Start with", message: "Start with" })}>
          <ToggleGroup type="single" variant="segmented" fill value={mode} onValueChange={chooseMode} aria-label={i18n._({ id: "Start with", message: "Start with" })}>
            <ToggleGroupItem value="describe">{i18n._({ id: "Describe", message: "Describe" })}</ToggleGroupItem>
            <ToggleGroupItem value="upload">{i18n._({ id: "Upload Photo", message: "Upload Photo" })}</ToggleGroupItem>
          </ToggleGroup>
          {mode === "describe"
            ? <Textarea aria-label={i18n._({ id: "Describe the character", message: "Describe the character" })} shape="rounded" maxRows={12} placeholder={i18n._({ id: "Describe the character you want to create...", message: "Describe the character you want to create..." })} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
            : <Input ref={fileInput} aria-label={i18n._({ id: "Photo", message: "Photo" })} type="file" shape="pill" accept="image/png,image/jpeg,image/webp" disabled={locked} aria-describedby={making.reason ? reasonId : undefined} onChange={(e) => { const chosen = e.target.files?.[0] ?? null; setFile(chosen); setUploadedId(null); maybeUpload(chosen); }} />}
          {mode === "upload" && thumb ? <div className="flex items-center gap-3"><img src={thumb} alt={i18n._({ id: "Your upload", message: "Your upload" })} draggable={false} className="size-14 rounded-xl object-cover" /><p className="min-w-0 truncate text-sm text-muted-foreground">{file?.name}</p></div> : null}
        </DialogSection>
      </div>
      <div className="flex flex-col gap-6">
        <DialogSection title={i18n._({ id: "Choose a style", message: "Choose a style" })}>
          {tiles.length ? <div className="grid grid-cols-3 gap-3">
            {tiles.map((tile) => <CharacterTile key={tile.id} variant="picture" name={tile.label} selected={style === tile.id}
              media={tile.custom ? <Palette className="size-6 text-muted-foreground" aria-hidden="true" /> : tile.id === "keep" ? <User className="size-6 text-muted-foreground" aria-hidden="true" /> : <Sparkles className="size-6 text-muted-foreground" aria-hidden="true" />}
              onSelect={() => { if (!locked) chooseStyle(tile.id); }} />)}
          </div> : <p className="text-sm text-muted-foreground">{stylesQuery.isError ? flowErrorText(stylesQuery.error) : lookQuery.isError ? flowErrorText(lookQuery.error) : i18n._({ id: "Loading the styles", message: "Loading the styles" })}</p>}
          {customSelected ? <Input aria-label={i18n._({ id: "Custom style", message: "Custom style" })} shape="pill" placeholder={i18n._({ id: "Type a style, for example paper cut-out", message: "Type a style, for example paper cut-out" })} maxLength={120} value={customStyle} disabled={locked} onChange={(e) => setCustomStyle(e.target.value)} /> : null}
        </DialogSection>
        <div className="flex flex-col gap-2">
          <Button shape="pill" width="full" disabled={!canGenerate || (mode === "upload" && style === "keep")} aria-describedby={making.reason ? reasonId : undefined} title={making.reason ?? undefined} aria-busy={makingCharacter} onClick={() => void generate()}>{makingCharacter ? <><Spinner className="animate-spin" aria-hidden="true" />{i18n._({ id: "Making your character...", message: "Making your character..." })}</> : <><Sparkles aria-hidden="true" />{i18n._({ id: "Generate Character", message: "Generate Character" })}</>}</Button>
          {look && !look.can_generate && look.generate_reason ? <p className="text-sm text-muted-foreground">{look.generate_reason}</p> : null}
          {making.reason ? <p id={reasonId} role="status" className="text-sm text-muted-foreground">{making.reason}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
      <DialogSection title={i18n._({ id: "Character Preview", message: "Character Preview" })}>
        <GenerationStage generating={generating || preparingPhoto || busyKind === "complete"} shape="panel" frame="strong" transparency="checker" aspectRatio="1 / 1">
          {picture
            ? <DraggablePicture src={picture.url} alt={i18n._({ id: "{name}, preview", message: "{name}, preview", values: { name: name.trim() || i18n._({ id: "Your character", message: "Your character" }) } })} frame={frame} baked={baked} disabled={placeLocked} onFrameChange={place} />
            : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
              <User className="size-12" aria-hidden="true" />
              <p>{generating ? i18n._({ id: "Getting your character started", message: "Getting your character started" }) : i18n._({ id: "Your character will appear here", message: "Your character will appear here" })}</p>
            </div>}
          {generating ? <div className="absolute inset-x-4 bottom-4 flex flex-col gap-2 rounded-2xl bg-background/90 p-3">
            <p className="text-center text-sm text-foreground">{job?.label ?? i18n._({ id: "Making your character", message: "Making your character" })}</p>
            <Progress mode="determinate" value={job?.percent ?? 0} label={job?.label ?? i18n._({ id: "Making your character", message: "Making your character" })} />
          </div> : preparingPhoto || busyKind === "complete" ? <div className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-2 rounded-2xl bg-background/90 p-3">
            <Progress mode="spinner" label={preparingPhoto ? i18n._({ id: "Getting your photo ready", message: "Getting your photo ready" }) : i18n._({ id: "Filling in the parts that were cut off", message: "Filling in the parts that were cut off" })} />
            <p className="text-sm text-foreground">{preparingPhoto ? i18n._({ id: "Getting your photo ready. This can take up to a minute.", message: "Getting your photo ready. This can take up to a minute." }) : i18n._({ id: "Filling in the parts that were cut off. This can take a minute.", message: "Filling in the parts that were cut off. This can take a minute." })}</p>
          </div> : null}
        </GenerationStage>
        <p className="text-sm text-muted-foreground">{picture ? i18n._({ id: "Drag the character to move it. Use the mouse wheel to zoom. Change the description or style and generate again until you're happy.", message: "Drag the character to move it. Use the mouse wheel to zoom. Change the description or style and generate again until you're happy." }) : i18n._({ id: "Change the description or style and generate again until you're happy with your character.", message: "Change the description or style and generate again until you're happy with your character." })}</p>
        {generating ? <Button variant="outline" shape="pill" onClick={() => void stop()}>{i18n._({ id: "Stop", message: "Stop" })}</Button> : null}
        {busyKind === "prepare" ? <p role="status" className="text-sm text-muted-foreground">{i18n._({ id: "Placing your character...", message: "Placing your character..." })}</p> : null}
        {preparingPhoto ? <p role="status" className="text-sm text-muted-foreground">{i18n._({ id: "Getting your photo ready...", message: "Getting your photo ready..." })}</p> : null}
        {busyKind === "complete" ? <p role="status" className="text-sm text-muted-foreground">{i18n._({ id: "Filling in the parts that were cut off...", message: "Filling in the parts that were cut off..." })}</p> : null}
        <Button shape="pill" width="full" disabled={!picture || locked || making.disabled} aria-describedby={making.reason ? reasonId : undefined} title={making.reason ?? undefined} aria-busy={busyKind === "approve"} onClick={() => void approve()}>
          {busyKind === "approve" ? <><Spinner className="animate-spin" aria-hidden="true" />{i18n._({ id: "Getting your character ready...", message: "Getting your character ready..." })}</> : <>{i18n._({ id: "Approve & Continue", message: "Approve & Continue" })}</>}
        </Button>
        {previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p> : null}
      </DialogSection>
    </DialogBody>
    </>
  );
}
