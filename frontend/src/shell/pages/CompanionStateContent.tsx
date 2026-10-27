import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Select } from "@maipai/ui/src/primitives/Select";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { StackedAlphaVideo } from "@maipai/ui/src/elements/stacked-alpha-video";
import { ApiError, api, type CompanionStateJob, type CompanionStateRow, type CompanionStateTake } from "@/lib/api";

const networkError = "Could not reach Home. Check your connection and try again.";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;
const sizeText = (bytes: number) => `${Math.round(bytes / 1000)} kB`;
const AV1_CODEC = 'video/mp4; codecs="av01.0.05M.08"';

function useClipPreview(urls: CompanionStateTake["urls"], label: string) {
  const [source, setSource] = useState(urls.h264);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [playAnyway, setPlayAnyway] = useState(false);
  useEffect(() => {
    const video = document.createElement("video");
    setSource(urls.av1 && video.canPlayType?.(AV1_CODEC) === "probably" ? urls.av1 : urls.h264);
    setFailed(false);
  }, [urls.av1, urls.h264]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(query.matches); setPlayAnyway(false); };
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const onError = useCallback(() => setFailed(true), []);
  const play = useCallback(() => setPlayAnyway(true), []);
  return { source, failed, reduced: reduced && !playAnyway, label, onError, play };
}

export function CompanionStateContents({ id, state, busy, startReady = true, sheetReady = true, onAction, onError }: { id: string; state: CompanionStateRow; busy: boolean; startReady?: boolean; sheetReady?: boolean; onAction: (action: () => Promise<unknown>) => Promise<void>; onError: (message: string) => void }) {
  const [motion, setMotion] = useState(state.motion);
  const [count, setCount] = useState("4");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [alpha, setAlpha] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [deleteTake, setDeleteTake] = useState<string | null>(null);
  const [forceTake, setForceTake] = useState<string | null>(null);
  const [forceMessage, setForceMessage] = useState("");
  const [finishingTake, setFinishingTake] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState("");
  useEffect(() => setMotion(state.motion), [state.motion]);
  const finishQuery = useQuery<CompanionStateJob>({ queryKey: ["companions", id, "states", "job", finishingTake], queryFn: () => api.companionStateJob(id, finishingTake!), enabled: !!finishingTake, retry: false, refetchInterval: (query) => document.hidden ? false : query.state.data?.state === "running" || query.state.data === undefined ? 1500 : false });
  useEffect(() => {
    if (finishQuery.data?.state === "done") void onAction(async () => undefined);
    if (finishQuery.data?.state === "failed") onError(finishQuery.data.failure ?? "The clip could not be finished. Try another clip.");
  }, [finishQuery.data?.state, finishQuery.data?.failure, onAction, onError]);
  const approved = state.approved?.take_id;
  const cardBusy = busy || state.busy;
  const takeRows = state.takes;
  const preview = useClipPreview(state.approved?.urls ?? { h264: "", av1: "", still: "" }, state.label);
  async function doUpload() {
    if (!file) return;
    const form = new FormData(); form.append("video", file); form.append("has_alpha", String(alpha));
    await onAction(async () => { const result = await api.uploadCompanionState(id, state.id, form); setFinishingTake(result.take_id); setUploadOpen(false); setFile(null); setAlpha(false); });
  }
  async function copyPrompt() {
    setCopyFallback("");
    try {
      const pack = await api.companionStatePrompt(id, state.id);
      try { await navigator.clipboard.writeText(pack.text); toast("Prompt copied. Paste it into your tool."); }
      catch { setCopyFallback(pack.text); }
    } catch (error) { onError(errorText(error)); }
  }
  return <>
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{state.label}</h3>{state.required ? <Badge>Required</Badge> : null}{approved ? <Badge>Approved for publishing</Badge> : null}</div>
    <p className="text-sm text-muted-foreground">{state.when_it_plays}</p>
    {state.approved ? <>{preview.failed || preview.reduced ? <img src={state.approved.urls.still} alt={`${state.label} clip still`} className="w-full object-contain" /> : <StackedAlphaVideo src={preview.source} loop label={preview.label} onError={preview.onError} />}{preview.failed ? <p className="text-center text-xs text-muted-foreground">Preview not available in this browser.</p> : null}{preview.reduced ? <Button type="button" variant="outline" onClick={preview.play}>Play</Button> : null}</> : <div className="companion-alpha-placeholder flex items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">No approved clip yet</div>}
    {approved ? <Button type="button" variant="outline" disabled={cardBusy} onClick={() => void onAction(() => api.removeCompanionStateApproval(id, state.id))}>Remove approval</Button> : null}
    <div className="flex flex-col gap-2"><Label htmlFor={`motion-${state.id}`}>Motion sentence</Label><Textarea id={`motion-${state.id}`} aria-label={`${state.label} motion`} maxLength={200} placeholder="Describe the movement in one sentence" value={motion} onChange={(event) => setMotion(event.target.value)} onBlur={() => { if (motion !== state.motion) void onAction(() => api.setCompanionStateMotion(id, state.id, motion.trim() || null)); }} />{motion !== state.default_motion ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setMotion(state.default_motion); void onAction(() => api.setCompanionStateMotion(id, state.id, null)); }}>Reset to default</Button> : null}</div>
    <div className="flex flex-col gap-2"><Select aria-label={`${state.label} clip count`} value={count} options={["1", "2", "3", "4"]} getLabel={(value) => value} onValueChange={setCount} disabled={cardBusy} /><div className="flex flex-wrap gap-2"><Button disabled={cardBusy || !startReady || !sheetReady} onClick={() => void onAction(() => api.generateCompanionState(id, state.id, { count: Number(count), motion: motion.trim() || undefined }))}>Make clips</Button><Button type="button" variant="outline" disabled={cardBusy || !sheetReady} onClick={() => setUploadOpen((open) => !open)}>Upload a clip</Button><Button type="button" variant="outline" onClick={() => void copyPrompt()}>Copy prompt</Button></div></div>
    {copyFallback ? <div className="flex flex-col gap-2"><Label htmlFor={`copy-clip-prompt-${state.id}`}>Copy this text yourself.</Label><Textarea id={`copy-clip-prompt-${state.id}`} readOnly value={copyFallback} onFocus={(event) => event.currentTarget.select()} /></div> : null}
    {uploadOpen ? <div className="flex flex-col gap-3"><div className="flex flex-col gap-1"><Label htmlFor={`clip-file-${state.id}`}>Clip (MP4, MOV or WebM)</Label><Input id={`clip-file-${state.id}`} type="file" accept="video/mp4,video/quicktime,video/webm" disabled={cardBusy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
      <div className="flex items-center gap-2"><Checkbox id={`clip-alpha-${state.id}`} checked={alpha} disabled={cardBusy} onCheckedChange={(value) => setAlpha(value === true)} /><Label htmlFor={`clip-alpha-${state.id}`}>This clip has a transparent background already</Label></div>
      <p className="text-sm text-muted-foreground">10 seconds or less, 30 MB or less. A clip on a plain green or magenta background works best: use the same colour as your character sheet.</p><Button disabled={!file || cardBusy} onClick={() => void doUpload()}>Upload</Button></div> : null}
    {finishingTake ? <div><p>{finishQuery.data?.label ?? "Finishing clip"}</p>{finishQuery.data?.report ? <Report report={finishQuery.data.report} /> : null}{finishQuery.data?.failure ? <p>Failed: {finishQuery.data.failure}</p> : null}</div> : null}
    {finishQuery.isError ? <Alert variant="destructive"><AlertDescription>{errorText(finishQuery.error)}</AlertDescription></Alert> : null}
    {takeRows.length ? <><Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>Clips ({takeRows.length})</Button>{expanded ? <ul className="flex list-none flex-col gap-4 p-0">{takeRows.map((take, takeIndex) => <li key={take.id}><Card size="sm"><CardContent><TakeItem state={state} take={take} index={takeIndex} busy={cardBusy} approved={take.id === approved} onApprove={async (force) => { try { await api.approveCompanionState(id, state.id, take.id, force); setForceTake(null); await onAction(async () => undefined); } catch (error) { if (error instanceof ApiError && error.code === "needs_force") { setForceTake(take.id); setForceMessage(error.message); } else onError(errorText(error)); } }} onDelete={() => setDeleteTake(take.id)} confirming={deleteTake === take.id} cancel={() => setDeleteTake(null)} deleteConfirm={() => void onAction(async () => { await api.deleteCompanionStateTake(id, state.id, take.id); setDeleteTake(null); })} /></CardContent></Card></li>)}</ul> : null}</> : null}
    {forceTake ? <Alert variant="destructive"><AlertDescription><p>{forceMessage}</p><Button variant="outline" onClick={() => { const take = takeRows.find((row) => row.id === forceTake); if (take) void api.approveCompanionState(id, state.id, take.id, true).then(() => { setForceTake(null); return onAction(async () => undefined); }).catch((error) => onError(errorText(error))); }}>Use it anyway</Button></AlertDescription></Alert> : null}
  </>;
}

function TakeItem({ state, take, index, busy, approved, onApprove, onDelete, confirming, cancel, deleteConfirm }: { state: CompanionStateRow; take: CompanionStateTake; index: number; busy: boolean; approved: boolean; onApprove: (force: boolean) => Promise<void>; onDelete: () => void; confirming: boolean; cancel: () => void; deleteConfirm: () => void }) {
  const size = take.bytes?.h264;
  const preview = useClipPreview(take.urls, `${state.label} clip ${index + 1}`);
  return <>{preview.failed || preview.reduced ? <img src={take.urls.still} alt={`${preview.label} still`} className="w-full object-contain" /> : <StackedAlphaVideo src={preview.source} loop label={preview.label} onError={preview.onError} />}{preview.failed ? <p className="text-center text-xs text-muted-foreground">Preview not available in this browser.</p> : null}{preview.reduced ? <Button type="button" variant="outline" onClick={preview.play}>Play</Button> : null}<div className="flex flex-wrap items-center gap-2"><span className="font-medium">{take.label}</span>{take.is_best ? <Badge>Best</Badge> : null}{approved ? <Badge>Approved for publishing</Badge> : null}</div>
    {take.seconds !== null && size !== undefined ? <p>{take.seconds.toFixed(1)} seconds, {sizeText(size)}</p> : null}{take.ok ? <p>Colours match well</p> : take.reasons.map((reason) => <p key={reason}>{reason}</p>)}
    <div className="flex flex-wrap gap-2">{approved ? null : <Button disabled={busy || take.seconds === null} onClick={() => void onApprove(false)}>Approve</Button>}{approved ? <span>Approved for publishing</span> : null}<Button type="button" variant="destructive" disabled={approved || busy} onClick={onDelete}>Delete</Button></div>
    {confirming ? <DestructiveConfirm message={`Delete ${take.label}?`} confirmLabel="Delete" busyLabel="Deleting" busy={busy} onConfirm={deleteConfirm} onCancel={cancel} /> : null}
  </>;
}
function Report({ report }: { report: NonNullable<CompanionStateJob["report"]> }) { return <div><p>{report.ok ? "Colours match well" : report.reasons.join(". ")}</p><p>{report.seconds.toFixed(1)} seconds, {sizeText(report.bytes.h264)}</p></div>; }
