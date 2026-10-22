import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { ApiError, api, type CompanionLook, type CompanionLookJob, type CompanionLookVersion } from "@/lib/api";

const queryKey = (id: string) => ["companions", id, "look"] as const;
const networkError = "Could not reach Home. Check your connection and try again.";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;
const GREEN_KEY = `#${"00FF00"}` as const;
const MAGENTA_KEY = `#${"FF00FF"}` as const;

export function CompanionLookTab({ id, prompt, promptError, onPromptChange, active }: { id: string; prompt: string; promptError?: string; onPromptChange: (value: string) => void; active: boolean }) {
  const client = useQueryClient();
  const lookQuery = useQuery({ queryKey: queryKey(id), queryFn: () => api.companionLook(id), enabled: active, retry: false });
  const [jobId, setJobId] = useState<string | null>(null);
  const jobQuery = useQuery<CompanionLookJob>({ queryKey: [...queryKey(id), "job", jobId], queryFn: () => api.companionLookJob(id, jobId!), enabled: active && jobId !== null, retry: false, refetchInterval: (q) => q.state.data?.state === "queued" || q.state.data?.state === "running" || q.state.data === undefined ? 1500 : false });
  const [formOpen, setFormOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [realPerson, setRealPerson] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [cardText, setCardText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const data = lookQuery.data;
  const job = jobQuery.data;
  const running = !!jobId && (job?.state === "queued" || job?.state === "running" || job === undefined);
  useEffect(() => { if (job?.state === "done") { void client.invalidateQueries({ queryKey: queryKey(id) }); setJobId(null); } }, [job?.state, id, client]);
  useEffect(() => { if (job?.state === "failed") { setError(job.error ?? "The picture could not be made. Try again."); setJobId(null); } }, [job?.state, job?.error]);
  useEffect(() => { if (data?.sheet?.card) setCardText(data.sheet.card.text); }, [data?.sheet?.card]);
  async function perform(action: () => Promise<unknown>) { setError(""); setNotice(""); setBusy(true); try { await action(); await client.invalidateQueries({ queryKey: queryKey(id) }); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function startJob(action: () => Promise<{ job: string }>) { setError(""); try { setJobId((await action()).job); } catch (e) { setError(errorText(e)); } }
  async function upload() { if (!file || !rights || realPerson) return; const body = new FormData(); body.append("image", file); body.append("rights_confirmed", "true"); body.append("shows_real_person", "false"); await perform(async () => { await api.uploadCompanionLook(id, body); setFormOpen(false); setFile(null); setRights(false); }); }
  async function copyPrompt() {
    setCopyFallback("");
    try {
      const pack = await api.companionLookPrompt(id);
      try { await navigator.clipboard.writeText(pack.text); toast("Prompt copied. Paste it into your tool."); }
      catch { setCopyFallback(pack.text); }
    } catch (cause) { setError(errorText(cause)); }
  }
  const rest = data?.versions.find((v) => v.id === data.rest);
  if (!active) return null;
  if (lookQuery.isError) return <AsyncState data={null} error onRetry={() => void lookQuery.refetch()} errorMessage={errorText(lookQuery.error)} loadingLabel="Loading companion look">{() => null}</AsyncState>;
  if (!data) return <AsyncState data={undefined} isFetching={lookQuery.isFetching} onRetry={() => void lookQuery.refetch()} loadingLabel="Loading companion look">{() => null}</AsyncState>;
  return <div className="flex flex-col gap-4">
    <Section heading="Look prompt"><div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Describe how the character looks: species, colours, clothes. Keep it simple and friendly.</p><Label htmlFor="look-prompt">Look prompt ({prompt.length}/600)</Label><Textarea id="look-prompt" aria-label="Look prompt" aria-invalid={Boolean(promptError)} maxLength={600} value={prompt} onChange={(e) => onPromptChange(e.target.value)} />{promptError ? <p role="alert" className="text-sm text-destructive">{promptError}</p> : null}</div></Section>
    <Section heading="Start"><div className="flex flex-wrap gap-2"><Button disabled={running || busy || !prompt.trim() || !data.can_generate} onClick={() => void startJob(() => api.generateCompanionLook(id, { prompt, count: 4 }))}>Generate 4 pictures</Button><Button type="button" variant="outline" disabled={running || busy} onClick={() => setFormOpen((v) => !v)}>Upload a picture</Button><Button type="button" variant="outline" onClick={() => void copyPrompt()}>Copy prompt</Button></div>{copyFallback ? <div className="flex flex-col gap-2"><Label htmlFor="copy-picture-prompt">Copy this text yourself.</Label><Textarea id="copy-picture-prompt" readOnly value={copyFallback} onFocus={(event) => event.currentTarget.select()} /></div> : null}{!data.can_generate && data.generate_reason ? <p className="text-sm text-muted-foreground">{data.generate_reason}</p> : null}{!prompt.trim() ? <p className="text-sm text-muted-foreground">Write a look prompt before generating pictures.</p> : null}
      {formOpen ? <div className="flex flex-col gap-3"><div className="flex flex-col gap-1"><Label htmlFor="look-upload">Picture (PNG, JPEG or WebP)</Label><Input id="look-upload" type="file" accept="image/png,image/jpeg,image/webp" disabled={running || busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div><div className="flex items-center gap-2"><Checkbox id="look-rights" checked={rights} disabled={running || busy} onCheckedChange={(v) => setRights(v === true)} /><Label htmlFor="look-rights">I made this picture or have the right to use it</Label></div><div className="flex items-center gap-2"><Checkbox id="look-real-person" checked={realPerson} disabled={running || busy} onCheckedChange={(v) => setRealPerson(v === true)} /><Label htmlFor="look-real-person">This is a picture of a real person</Label></div>{realPerson ? <Alert><AlertDescription>Pictures of real people are not supported here yet. Use a drawing or a character instead.</AlertDescription></Alert> : null}<Button disabled={!file || !rights || realPerson || running || busy} onClick={() => void upload()}>Upload</Button></div> : null}
    </Section>
    {running ? <Section heading="Picture progress"><p>{job?.label ?? "Starting picture"}</p><Progress value={job?.percent ?? 0} aria-label={job?.label ?? "Picture progress"} /><Button variant="outline" onClick={() => void perform(async () => { await api.cancelCompanionLookJob(id, jobId!); setJobId(null); })}>Stop</Button></Section> : null}
    <Section heading="Pictures">
      {data?.versions.length ? <ul aria-label="Pictures" className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {[...data.versions].reverse().map((version) => <LookVersionItem
          key={version.id} version={version} rest={version.id === data.rest} busy={running || busy}
          editing={editId === version.id}
          onRest={() => void perform(async () => {
            const result = await api.setCompanionLookRest(id, version.id);
            if (result.sheet_reset) setNotice("Changing the starting picture reset the character sheet. Make the sheet again and approve it.");
          })}
          onEdit={() => { setEditId(editId === version.id ? null : version.id); setInstruction(""); }}
          onDelete={() => setDeleteId(version.id)} instruction={instruction} onInstruction={setInstruction}
          onSend={() => void startJob(() => api.editCompanionLook(id, { version_id: version.id, instruction }))}
          onDeleteConfirm={() => void perform(async () => { await api.deleteCompanionLookVersion(id, version.id); setDeleteId(null); })}
          confirming={deleteId === version.id} cancelDelete={() => setDeleteId(null)} />)}
      </ul> : <p className="text-sm text-muted-foreground">No pictures yet. Upload one or generate four.</p>}
    </Section>
    {rest ? <SheetSection id={id} data={data!} rest={rest} cardText={cardText} setCardText={setCardText} busy={busy || running} perform={perform} startJob={startJob} /> : null}
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}{notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}
    {jobQuery.isError ? <Alert variant="destructive"><AlertDescription>{errorText(jobQuery.error)}</AlertDescription></Alert> : null}
  </div>;
}

function LookVersionItem({ version, rest, busy, editing, onRest, onEdit, onDelete, instruction, onInstruction, onSend, onDeleteConfirm, confirming, cancelDelete }: { version: CompanionLookVersion; rest: boolean; busy: boolean; editing: boolean; onRest: () => void; onEdit: () => void; onDelete: () => void; instruction: string; onInstruction: (value: string) => void; onSend: () => void; onDeleteConfirm: () => void; confirming: boolean; cancelDelete: () => void }) {
  return <li><Card><CardContent><div className="flex flex-col gap-3"><img src={version.url} alt={version.label} className="aspect-square w-full rounded-md bg-muted object-contain" /><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{version.label}</span>{rest ? <Badge>Starting picture</Badge> : null}</div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={rest || busy} onClick={onRest}>Use as starting picture</Button><Button variant="outline" disabled={busy} onClick={onEdit}>Change it</Button><Button variant="destructive" disabled={rest || busy} onClick={onDelete}>Delete</Button></div>{rest ? <p className="text-sm text-muted-foreground">Pick another starting picture first.</p> : null}{editing ? <div className="flex flex-col gap-2"><Label htmlFor={`edit-${version.id}`}>Say what to change</Label><Textarea id={`edit-${version.id}`} maxLength={300} showCount value={instruction} onChange={(e) => onInstruction(e.target.value)} /><Button disabled={!instruction.trim() || busy} onClick={onSend}>Send</Button></div> : null}{confirming ? <DestructiveConfirm message={`Delete ${version.label}?`} confirmLabel="Delete" busyLabel="Deleting" onConfirm={onDeleteConfirm} onCancel={cancelDelete} /> : null}</div></CardContent></Card></li>;
}

function SheetSection({ id, data, rest, cardText, setCardText, busy, perform, startJob }: { id: string; data: CompanionLook; rest: CompanionLookVersion; cardText: string; setCardText: (value: string) => void; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void>; startJob: (action: () => Promise<{ job: string }>) => Promise<void> }) {
  const sheet = data.sheet;
  const views = [{ label: "Turned left", view: sheet?.views.left }, { label: "Turned right", view: sheet?.views.right }, { label: "Mouth open", view: sheet?.views.mouth }];
  const state = sheet?.state ?? "empty";
  const status = state === "approved" ? "Approved" : state === "needs_review" ? "Needs your review" : state === "making" ? "Making" : "Not started";
  return <Section heading="Character sheet"><Badge>{status}</Badge><div className="grid gap-3 sm:grid-cols-4"><img src={rest.url} alt="Starting character" className="aspect-square w-full rounded-md bg-muted object-contain" />{views.map(({ label, view }) => view ? <img key={label} src={view.url} alt={label} className="aspect-square w-full rounded-md bg-muted object-contain" /> : <div key={label} className="flex aspect-square items-center justify-center rounded-md bg-muted text-center text-sm text-muted-foreground">{label}</div>)}</div>
    {sheet?.card ? <div className="flex flex-col gap-2"><Label htmlFor="look-card">Description card</Label><Textarea id="look-card" minLength={20} maxLength={600} showCount value={cardText} onChange={(e) => setCardText(e.target.value)} /><Button variant="outline" disabled={busy || cardText.trim().length < 20} onClick={() => void perform(() => api.saveCompanionLookCard(id, { text: cardText }))}>Save card</Button></div> : null}
    {sheet ? <div className="flex flex-col gap-2"><Label>Key colour</Label><Select aria-label="Key colour" value={sheet.key} options={[GREEN_KEY, MAGENTA_KEY]} getLabel={(v) => v === GREEN_KEY ? "Green background (default)" : "Magenta background (use when the character has green)"} disabled={busy || state === "approved"} onValueChange={(value) => void perform(() => api.setCompanionLookKey(id, value as typeof GREEN_KEY | typeof MAGENTA_KEY))} /></div> : null}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !data.rest} onClick={() => void startJob(() => api.makeCompanionLookSheet(id))}>{views.some((v) => v.view) ? "Make the sheet again" : "Make the sheet"}</Button>{state === "approved" ? <Button variant="outline" disabled={busy} onClick={() => void perform(() => api.unapproveCompanionLookSheet(id))}>Edit the sheet</Button> : <Button variant="outline" disabled={busy} onClick={() => void perform(() => api.approveCompanionLookSheet(id))}>Approve the sheet</Button>}</div>
    <p className="text-sm text-muted-foreground">Every video of this character will start from this picture and this description.</p>
  </Section>;
}
