import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Label } from "@maipai/ui/src/ui/label";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { api, ApiError, type CompanionEditable, type CompanionFields } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { useTabItem } from "@/shell/tabIdentity";

const key = ["companions"] as const;
type Form = CompanionFields & Pick<CompanionEditable, "name" | "audience">;
const blank: Form = { name: "", pronouns: "", tagline: "", backstory: "", interests: [], formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", behavior: [], examples: [], examples_child: [], examples_teen: [], examples_adult: [], voice_id: "default", audience: "adult" };
const dialOptions = {
  formality: { label: "Formality", options: ["casual", "neutral", "formal"], words: ["Talks like a friend", "Plain and polite", "Careful and proper"] },
  complexity: { label: "Word choice", options: ["simple", "standard", "advanced"], words: ["Short, simple words", "Everyday words", "Rich, detailed words"] },
  engagement: { label: "Questions back", options: ["brief", "balanced", "curious"], words: ["Keeps it short and moves on", "Asks a follow-up now and then", "Asks you things back and wants to know more"] },
  filler_density: { label: "Casual chatter", options: ["none", "light", "frequent"], words: ["No filler words", "A few casual words, like honestly", "Lots of casual chatter"] },
} as const;
function errorText(error: unknown) { return error instanceof ApiError ? error.message : "Could not reach Home. Check your connection and try again."; }
function audienceWords(audience: Form["audience"]) { return audience === "adult" ? "Adults only" : audience === "teen" ? "Teens and adults" : "Everyone"; }

export function CompanionEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [...key, "edit", id], queryFn: () => api.editCompanion(id!), enabled: !isNew, retry: false });
  const [form, setForm] = useState<Form>(blank);
  const [initial, setInitial] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("identity");
  const dirty = isNew ? JSON.stringify(form) !== JSON.stringify(blank) : JSON.stringify(form) !== initial;
  useEffect(() => { if (query.data) { const data = query.data; const next: Form = { ...blank, name: data.name, pronouns: data.pronouns, tagline: data.tagline, backstory: data.backstory, interests: data.interests, formality: data.formality, complexity: data.complexity, engagement: data.engagement, filler_density: data.filler_density, behavior: data.behavior, examples: data.examples, examples_child: data.examples_child, examples_teen: data.examples_teen, examples_adult: data.examples_adult, voice_id: data.voice_id, audience: data.audience }; setForm(next); setInitial(JSON.stringify(next)); } }, [query.data]);
  useTabItem(form.name || "New companion");
  const save = useMutation({ mutationFn: (fields: CompanionFields) => isNew ? api.createCompanion(fields) : api.updateCompanion(id!, fields), onSuccess: (result) => { setError(""); setForm((old) => ({ ...old })); if (isNew) navigate(`/companions/${encodeURIComponent(result.id)}/edit`); else { setInitial(JSON.stringify(form)); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); void queryClient.invalidateQueries({ queryKey: [...key, "edit", id] }); void queryClient.invalidateQueries({ queryKey: key }); } } });
  const status = useMutation({ mutationFn: (next: "draft" | "ready") => api.setCompanionStatus(id!, next), onSuccess: () => { setError(""); void queryClient.invalidateQueries({ queryKey: [...key, "edit", id] }); void query.refetch(); } });
  const remove = useMutation({ mutationFn: () => api.deleteCompanion(id!), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: key }); navigate("/companions"); } });
  const copy = useMutation({ mutationFn: () => api.copyCompanion(id!), onSuccess: (result) => navigate(`/companions/${encodeURIComponent(result.id)}/edit`) });
  const update = <K extends keyof Form>(field: K, value: Form[K]) => setForm((current) => ({ ...current, [field]: value }));
  const companion = query.data;
  const mutationError = error || (save.isError ? errorText(save.error) : status.isError ? errorText(status.error) : remove.isError ? errorText(remove.error) : copy.isError ? errorText(copy.error) : "");
  if (!isNew && query.isError && query.error instanceof ApiError && query.error.status === 404) return <EmptyState icon="user" text="That companion is not yours to edit. Open it from the Companions app, or make a copy." />;
  return <div className="flex flex-col gap-6" data-testid="companion-editor">
    <Link to="/companions" className="text-sm underline">All companions</Link>
    <AsyncState data={isNew ? true : query.isError ? null : companion} error={!isNew && query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={query.error instanceof ApiError ? query.error.message : "Could not reach Home. Check your connection and try again."} loadingLabel="Loading companion">
      {() => <>
        <header className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-bold">{form.name || "New companion"}</h1>{companion ? <><Badge>{companion.status === "draft" ? "Draft" : "Ready"}</Badge><Badge>{audienceWords(form.audience)}</Badge></> : null}
          {!isNew && companion?.can_copy ? <Button variant="outline" onClick={() => copy.mutate()}>Make a copy</Button> : null}
          {!isNew && companion?.status === "draft" ? <Button onClick={() => status.mutate("ready")}>Mark ready</Button> : null}
          {!isNew && companion?.status === "ready" ? <Button variant="outline" onClick={() => status.mutate("draft")}>Back to draft</Button> : null}
        </header>
        {companion?.status === "ready" ? <Alert><AlertDescription>People can pick this companion now. Changes you save apply right away.</AlertDescription></Alert> : null}
        {dirty ? <Alert><AlertDescription>You have changes that are not saved</AlertDescription></Alert> : null}
        {mutationError ? <Alert variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
        <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="identity">Identity</TabsTrigger><TabsTrigger value="voice">Voice and style</TabsTrigger></TabsList>
          <TabsContent value="identity"><div className="flex flex-col gap-4"><Section heading="Identity">
            <div className="flex flex-col gap-2"><Label htmlFor="companion-name">Name</Label><Input id="companion-name" aria-label="Name" value={form.name} onChange={(e) => update("name", e.target.value)} /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="companion-pronouns">Pronouns</Label><Input id="companion-pronouns" aria-label="Pronouns" value={form.pronouns ?? ""} onChange={(e) => update("pronouns", e.target.value)} /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="companion-tagline">One-line description</Label><Input id="companion-tagline" aria-label="One-line description" maxLength={80} value={form.tagline} onChange={(e) => update("tagline", e.target.value)} /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="companion-backstory">About</Label><Textarea id="companion-backstory" aria-label="About" maxLength={400} showCount value={form.backstory} onChange={(e) => update("backstory", e.target.value)} /></div>
            <StringRows label="Interests" values={form.interests ?? []} max={8} onChange={(values) => update("interests", values)} />
          </Section></div></TabsContent>
          <TabsContent value="voice"><div className="flex flex-col gap-4"><Section heading="Voice and style">
            {Object.entries(dialOptions).map(([field, def]) => <div className="flex flex-col gap-2" key={field}><Label>{def.label}</Label><Select aria-label={def.label} value={String(form[field as keyof Form] ?? def.options[1])} options={[...def.options]} getLabel={(v) => def.words[def.options.indexOf(v as never)] ?? v} onValueChange={(v) => update(field as keyof Form, v as never)} /></div>)}
            <StringRows label="Behavior" values={form.behavior ?? []} max={6} onChange={(values) => update("behavior", values)} />
            <StringRows label="Example lines" values={form.examples ?? []} min={3} max={5} onChange={(values) => update("examples", values)} />
            {(["child", "teen", "adult"] as const).map((band) => <details key={band}><summary className="cursor-pointer font-medium">{band[0]!.toUpperCase() + band.slice(1)} examples</summary><p className="text-sm text-muted-foreground">Used when this companion talks to a {band}</p><StringRows label={`${band} examples`} values={form[`examples_${band}`] ?? []} max={4} onChange={(values) => update(`examples_${band}`, values)} /></details>)}
            <VoicePicker value={form.voice_id ?? "default"} onChange={(value) => update("voice_id", value)} />
          </Section></div></TabsContent>
        </Tabs>
        <footer className="flex flex-wrap gap-2"><Button disabled={!dirty || save.isPending} onClick={() => { setError(""); const fields = Object.fromEntries(Object.entries(form).filter(([field]) => field !== "audience")) as CompanionFields; save.mutate(fields); }}>{savedFlash ? "Saved" : save.isPending ? "Saving" : "Save"}</Button>
          {!isNew && companion?.can_edit ? <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete</Button> : null}</footer>
        {confirmDelete ? <DestructiveConfirm message={`Delete ${form.name}?`} confirmLabel="Delete" busyLabel="Deleting" busy={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirmDelete(false)} /> : null}
      </>}
    </AsyncState>
  </div>;
}
function StringRows({ label, values, max, min = 0, onChange }: { label: string; values: string[]; max: number; min?: number; onChange: (values: string[]) => void }) { return <fieldset className="flex flex-col gap-2"><legend className="text-base font-medium">{label} ({values.length}{min ? `, at least ${min}` : ""}/{max})</legend>{values.map((value, i) => <div className="flex gap-2" key={i}><Input aria-label={`${label} ${i + 1}`} value={value} onChange={(e) => onChange(values.map((item, j) => j === i ? e.target.value : item))} /><Button type="button" variant="outline" onClick={() => onChange(values.filter((_, j) => i !== j))}>Remove</Button></div>)}{values.length < max ? <Button type="button" variant="outline" onClick={() => onChange([...values, ""])}>Add {label === "Interests" ? "interest" : "line"}</Button> : null}</fieldset>; }
function VoicePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const voices = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices, retry: false });
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => { const unsub = voicePreviewPlayer.subscribe(setPreview); return () => { unsub(); voicePreviewPlayer.stop(); }; }, []);
  const list = voices.data?.voices ?? [];
  const choices = list.length ? voiceChoices(playableVoices(list), value, [value]) : null;
  const id = choices?.selected ? previewIdFor(choices.selected, list) : null;
  const active = id !== null && preview.voiceId === id;
  return <div className="flex flex-col gap-2"><div className="flex flex-col gap-2"><Label>Voice</Label><Select aria-label="Voice" value={choices?.selected.value ?? value} options={choices?.options.map((o) => o.value) ?? [value]} getLabel={(v) => choices?.options.find((o) => o.value === v)?.label ?? v} onValueChange={onChange} /></div><Button type="button" variant="outline" disabled={!id || (active && preview.busy)} onClick={() => active ? voicePreviewPlayer.stop() : id && void voicePreviewPlayer.start(id)}>{active && !preview.busy ? "Stop" : "Play a sample"}</Button>{preview.error ? <p role="alert">{preview.error}</p> : null}</div>;
}
