import { useEffect, useState } from "react";
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
import { ApiError, api, type CompanionStateJob, type CompanionStateRow, type CompanionStateTake } from "@/lib/api";
import { StackedAlphaPreview } from "@/shell/pages/StackedAlphaPreview";

const networkError = "Could not reach Home. Check your connection and try again.";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;
const sizeText = (bytes: number) => `${Math.round(bytes / 1000)} kB`;

export function CompanionStateContents({ id, state, index, busy, startReady = true, sheetReady = true, onAction, onError }: { id: string; state: CompanionStateRow; index: number; busy: boolean; startReady?: boolean; sheetReady?: boolean; onAction: (action: () => Promise<unknown>) => Promise<void>; onError: (message: string) => void }) {
  const [motion, setMotion] = useState(state.motion);
  const [count, setCount] = useState("4");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [alpha, setAlpha] = useState(false);
  const [realPerson, setRealPerson] = useState(false);
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
  async function doUpload() {
    if (!file || !rights || realPerson) return;
    const form = new FormData(); form.append("video", file); form.append("rights_confirmed", "true"); form.append("shows_real_person", "false"); form.append("has_alpha", String(alpha));
    await onAction(async () => { const result = await api.uploadCompanionState(id, state.id, form); setFinishingTake(result.take_id); setUploadOpen(false); setFile(null); setRights(false); setAlpha(false); });
  }
  async function copyPrompt() {
    setCopyFallback("");
    try {
      const pack = await api.companionStatePrompt(id, state.id);
      try { await navigator.clipboard.writeText(pack.text); toast("Prompt copied. Paste it into your tool."); }
      catch { setCopyFallback(pack.text); }
    } catch (error) { onError(errorText(error)); }
  }
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{state.label}</h3>{state.required ? <Badge>Required</Badge> : null}{approved ? <Badge>In use</Badge> : null}</div>
    <p className="text-sm text-muted-foreground">{state.when_it_plays}</p>
    {state.approved ? <StackedAlphaPreview urls={state.approved.urls} label={state.label} priority={index < 2} /> : <div className="companion-alpha-placeholder flex items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">No approved clip yet</div>}
    {approved ? <Button type="button" variant="outline" disabled={cardBusy} onClick={() => void onAction(() => api.removeCompanionStateApproval(id, state.id))}>Remove approval</Button> : null}
    <div className="flex flex-col gap-2"><Label htmlFor={`motion-${state.id}`}>Motion sentence</Label><Textarea id={`motion-${state.id}`} aria-label={`${state.label} motion`} maxLength={200} placeholder="Describe the movement in one sentence" value={motion} onChange={(event) => setMotion(event.target.value)} onBlur={() => { if (motion !== state.motion) void onAction(() => api.setCompanionStateMotion(id, state.id, motion.trim() || null)); }} />{motion !== state.default_motion ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setMotion(state.default_motion); void onAction(() => api.setCompanionStateMotion(id, state.id, null)); }}>Reset to default</Button> : null}</div>
    <div className="flex flex-col gap-2"><Select aria-label={`${state.label} clip count`} value={count} options={["1", "2", "3", "4"]} getLabel={(value) => value} onValueChange={setCount} disabled={cardBusy} /><div className="flex flex-wrap gap-2"><Button disabled={cardBusy || !startReady || !sheetReady} onClick={() => void onAction(() => api.generateCompanionState(id, state.id, { count: Number(count), motion: motion.trim() || undefined }))}>Make clips</Button><Button type="button" variant="outline" disabled={cardBusy || !sheetReady} onClick={() => setUploadOpen((open) => !open)}>Upload a clip</Button><Button type="button" variant="outline" onClick={() => void copyPrompt()}>Copy prompt</Button></div></div>
    {copyFallback ? <div className="flex flex-col gap-2"><Label htmlFor={`copy-clip-prompt-${state.id}`}>Copy this text yourself.</Label><Textarea id={`copy-clip-prompt-${state.id}`} readOnly value={copyFallback} onFocus={(event) => event.currentTarget.select()} /></div> : null}
    {uploadOpen ? <div className="flex flex-col gap-3"><div className="flex flex-col gap-1"><Label htmlFor={`clip-file-${state.id}`}>Clip (MP4, MOV or WebM)</Label><Input id={`clip-file-${state.id}`} type="file" accept="video/mp4,video/quicktime,video/webm" disabled={cardBusy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
      <div className="flex items-center gap-2"><Checkbox id={`clip-rights-${state.id}`} checked={rights} disabled={cardBusy} onCheckedChange={(value) => setRights(value === true)} /><Label htmlFor={`clip-rights-${state.id}`}>I made this clip or have the right to use it</Label></div>
      <div className="flex items-center gap-2"><Checkbox id={`clip-alpha-${state.id}`} checked={alpha} disabled={cardBusy} onCheckedChange={(value) => setAlpha(value === true)} /><Label htmlFor={`clip-alpha-${state.id}`}>This clip has a transparent background already</Label></div>
      <div className="flex items-center gap-2"><Checkbox id={`clip-real-${state.id}`} checked={realPerson} disabled={cardBusy} onCheckedChange={(value) => setRealPerson(value === true)} /><Label htmlFor={`clip-real-${state.id}`}>This clip shows a real person</Label></div>
      {realPerson ? <Alert><AlertDescription>Clips of real people are not supported here yet. Use a drawing or a character instead.</AlertDescription></Alert> : null}
      <p className="text-sm text-muted-foreground">10 seconds or less, 30 MB or less. A clip on a plain green or magenta background works best: use the same colour as your character sheet.</p><Button disabled={!file || !rights || realPerson || cardBusy} onClick={() => void doUpload()}>Upload</Button></div> : null}
    {finishingTake ? <div><p>{finishQuery.data?.label ?? "Finishing clip"}</p>{finishQuery.data?.report ? <Report report={finishQuery.data.report} /> : null}{finishQuery.data?.failure ? <p>Failed: {finishQuery.data.failure}</p> : null}</div> : null}
    {finishQuery.isError ? <Alert variant="destructive"><AlertDescription>{errorText(finishQuery.error)}</AlertDescription></Alert> : null}
    {takeRows.length ? <><Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>Clips ({takeRows.length})</Button>{expanded ? <ul className="flex list-none flex-col gap-4 p-0">{takeRows.map((take, takeIndex) => <li key={take.id}><Card size="sm"><CardContent><TakeItem state={state} take={take} index={takeIndex} busy={cardBusy} approved={take.id === approved} onApprove={async (force) => { try { await api.approveCompanionState(id, state.id, take.id, force); setForceTake(null); await onAction(async () => undefined); } catch (error) { if (error instanceof ApiError && error.code === "needs_force") { setForceTake(take.id); setForceMessage(error.message); } else onError(errorText(error)); } }} onDelete={() => setDeleteTake(take.id)} confirming={deleteTake === take.id} cancel={() => setDeleteTake(null)} deleteConfirm={() => void onAction(async () => { await api.deleteCompanionStateTake(id, state.id, take.id); setDeleteTake(null); })} /></CardContent></Card></li>)}</ul> : null}</> : null}
    {forceTake ? <Alert variant="destructive"><AlertDescription><p>{forceMessage}</p><Button variant="outline" onClick={() => { const take = takeRows.find((row) => row.id === forceTake); if (take) void api.approveCompanionState(id, state.id, take.id, true).then(() => { setForceTake(null); return onAction(async () => undefined); }).catch((error) => onError(errorText(error))); }}>Use it anyway</Button></AlertDescription></Alert> : null}
  </div>;
}

function TakeItem({ state, take, index, busy, approved, onApprove, onDelete, confirming, cancel, deleteConfirm }: { state: CompanionStateRow; take: CompanionStateTake; index: number; busy: boolean; approved: boolean; onApprove: (force: boolean) => Promise<void>; onDelete: () => void; confirming: boolean; cancel: () => void; deleteConfirm: () => void }) {
  const size = take.bytes?.h264;
  return <div className="flex flex-col gap-2"><StackedAlphaPreview urls={take.urls} label={`${state.label} clip ${index + 1}`} priority={false} /><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{take.label}</span>{take.is_best ? <Badge>Best</Badge> : null}{approved ? <Badge>In use</Badge> : null}</div>
    {take.seconds !== null && size !== undefined ? <p>{take.seconds.toFixed(1)} seconds, {sizeText(size)}</p> : null}{take.ok ? <p>Colours match well</p> : take.reasons.map((reason) => <p key={reason}>{reason}</p>)}
    <div className="flex flex-wrap gap-2">{approved ? null : <Button disabled={busy || take.seconds === null} onClick={() => void onApprove(false)}>Use this one</Button>}{approved ? <span>In use</span> : null}<Button type="button" variant="destructive" disabled={approved || busy} onClick={onDelete}>Delete</Button></div>
    {confirming ? <DestructiveConfirm message={`Delete ${take.label}?`} confirmLabel="Delete" busyLabel="Deleting" busy={busy} onConfirm={deleteConfirm} onCancel={cancel} /> : null}
  </div>;
}
function Report({ report }: { report: NonNullable<CompanionStateJob["report"]> }) { return <div><p>{report.ok ? "Colours match well" : report.reasons.join(". ")}</p><p>{report.seconds.toFixed(1)} seconds, {sizeText(report.bytes.h264)}</p></div>; }
