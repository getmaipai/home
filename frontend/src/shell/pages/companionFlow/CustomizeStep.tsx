import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogBody, DialogFooter, DialogSection, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Switch } from "@maipai/ui/src/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { CompanionStage } from "@maipai/ui/src/elements/companion-stage";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type CompanionEditable, type CompanionPersonality } from "@/lib/api";
import { AddVoiceForm } from "@/apps/settings/AddVoiceForm";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { lookKey } from "@/shell/pages/companionFlow/CreateCharacterStep";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const PERSONALITIES: () => Array<{ id: CompanionPersonality; label: string }> = () => ([
  { id: "friendly", label: i18n._({ id: "Friendly", message: "Friendly" }) }, { id: "funny", label: i18n._({ id: "Funny", message: "Funny" }) }, { id: "calm", label: i18n._({ id: "Calm", message: "Calm" }) },
  { id: "professional", label: i18n._({ id: "Professional", message: "Professional" }) }, { id: "playful", label: i18n._({ id: "Playful", message: "Playful" }) }, { id: "custom", label: i18n._({ id: "Custom", message: "Custom" }) },
]);

// The five presets differ in these five dials, so a saved companion can be matched back to its chip when it is reopened.
// Anything else (an older or hand-edited companion) reads as Custom and keeps its own dials until the person picks a chip.
const SIGNATURES: Record<Exclude<CompanionPersonality, "custom">, string> = {
  friendly: "casual|standard|curious|light|medium", funny: "casual|standard|balanced|light|high", calm: "neutral|simple|brief|none|low",
  professional: "formal|advanced|brief|none|low", playful: "casual|simple|curious|frequent|high",
};
export function guessPersonality(saved: Pick<CompanionEditable, "formality" | "complexity" | "engagement" | "filler_density" | "humor">): CompanionPersonality {
  const signature = [saved.formality, saved.complexity, saved.engagement, saved.filler_density, saved.humor].join("|");
  return (Object.entries(SIGNATURES).find(([, value]) => value === signature)?.[0] as CompanionPersonality | undefined) ?? "custom";
}

export const NOTES_MAX = 300;
export const BACKSTORY_MAX = 400;

/** Screen 3, Customize Companion. Back and the way-back button on a save error are the dialog's. */
export function CustomizeStep({ companionId, name, onBack, onGoTo }: { companionId: string; name: string; onBack: () => void; onGoTo: (step: 0 | 1) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ["companions", companionId, "edit"], queryFn: () => api.editCompanion(companionId), retry: false });
  const look = useQuery({ queryKey: lookKey(companionId), queryFn: () => api.companionLook(companionId), retry: false });
  const voices = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices, retry: false });
  const [voiceId, setVoiceId] = useState("default");
  const [personality, setPersonality] = useState<CompanionPersonality>("friendly");
  const [notes, setNotes] = useState("");
  const [backstory, setBackstory] = useState("");
  const [pins, setPins] = useState<{ dials: string[]; examples: string[] }>({ dials: [], examples: [] });
  const [pinError, setPinError] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; back: "look" | "animations" | null }>({ text: "", back: null });
  const seeded = useRef(false);
  const Mic = getIcon("mic"), Heart = getIcon("heart"), Book = getIcon("book"), Sparkles = getIcon("sparkles"), Back = getIcon("arrow-left");

  // An existing companion opens with what it has: its voice, the chip its dials match, its style notes and its backstory.
  useEffect(() => {
    if (seeded.current || !saved.data) return;
    seeded.current = true;
    // A draft has none of these fields yet; an older companion may lack some.
    const data = saved.data, behavior = data.behavior ?? [], text = data.backstory ?? "";
    setVoiceId(data.voice_id || "default");
    setPersonality(data.status === "draft" && behavior.length === 0 && !text ? "friendly" : guessPersonality(data));
    setNotes(behavior.join(" ").slice(0, NOTES_MAX));
    setBackstory(text.slice(0, BACKSTORY_MAX));
    setPins(data.synth?.pins ?? { dials: [], examples: [] });
  }, [saved.data]);
  useEffect(() => { const unsubscribe = voicePreviewPlayer.subscribe(setPreview); return () => { unsubscribe(); voicePreviewPlayer.stop(); }; }, []);

  const list = voices.data?.voices ?? [];
  const choices = list.length ? voiceChoices(playableVoices(list), voiceId, [voiceId]) : null;
  const selectedValue = choices?.selected.value ?? voiceId;
  const previewId = choices ? previewIdFor(choices.selected, list) : null;
  const playing = previewId !== null && preview.voiceId === previewId;
  const portrait = look.data?.versions.find((v) => v.id === (look.data?.rest ?? ""))?.url ?? look.data?.versions[look.data.versions.length - 1]?.url ?? null;
  const loading = saved.isLoading;
  const dialRows = [
    { key: "formality", label: i18n._({ id: "Formality", message: "Formality" }), value: saved.data?.formality },
    { key: "complexity", label: i18n._({ id: "Complexity", message: "Complexity" }), value: saved.data?.complexity },
    { key: "engagement", label: i18n._({ id: "Engagement", message: "Engagement" }), value: saved.data?.engagement },
    { key: "filler_density", label: i18n._({ id: "Filler density", message: "Filler density" }), value: saved.data?.filler_density },
    { key: "clock_style", label: i18n._({ id: "Clock style", message: "Clock style" }), value: saved.data?.clock_style },
    { key: "hedging", label: i18n._({ id: "Hedging", message: "Hedging" }), value: saved.data?.hedging },
    { key: "humor", label: i18n._({ id: "Humor", message: "Humor" }), value: saved.data?.humor },
    { key: "warmth", label: i18n._({ id: "Warmth", message: "Warmth" }), value: saved.data?.warmth },
    { key: "initiative", label: i18n._({ id: "Initiative", message: "Initiative" }), value: saved.data?.initiative },
  ];
  const examples = [...new Set([...(saved.data?.examples ?? []), ...(saved.data?.examples_child ?? []), ...(saved.data?.examples_teen ?? []), ...(saved.data?.examples_adult ?? [])])];

  async function togglePin(kind: "dials" | "examples", value: string) {
    const current = pins;
    const next = { ...current, [kind]: current[kind].includes(value) ? current[kind].filter((item) => item !== value) : [...current[kind], value] };
    setPins(next); setPinError("");
    try {
      await api.updateCompanion(companionId, { pins: next });
      await client.invalidateQueries({ queryKey: ["companions", companionId, "edit"] });
    } catch (e) {
      setPins(current);
      setPinError(flowErrorText(e));
    }
  }

  function chooseSource(next: string) {
    if (next === "clone") { setNotice(""); setCloning(true); }
  }
  async function generate() {
    setError({ text: "", back: null }); setGenerating(true);
    try {
      const hint = notes.trim() || (personality === "custom" ? "" : `${personality.charAt(0).toUpperCase()}${personality.slice(1)}`);
      const result = await api.generateCompanionBackstory(companionId, hint ? { hint: hint.slice(0, 300) } : {});
      setBackstory(result.text.slice(0, BACKSTORY_MAX));
    } catch (e) { setError({ text: flowErrorText(e), back: null }); } finally { setGenerating(false); }
  }
  async function save() {
    setError({ text: "", back: null }); setSaving(true);
    try {
      await api.saveCompanion(companionId, { voice_id: selectedValue, personality, ...(notes.trim() ? { style_notes: notes.trim() } : {}), ...(backstory.trim() ? { backstory: backstory.trim() } : {}) });
      await Promise.all([client.invalidateQueries({ queryKey: ["companions"] }), client.invalidateQueries({ queryKey: ["companions", companionId, "edit"] })]);
      navigate("/companions");
    } catch (e) {
      setError({ text: flowErrorText(e), back: e instanceof ApiError ? e.goBackTo ?? null : null });
      setSaving(false);
    }
  }

  return (
    <>
    <DialogBody columns="two">
      <div className="flex flex-col gap-6">
        <DialogSection title={i18n._({ id: "Voice", message: "Voice" })} icon={<Mic aria-hidden="true" />}>
          <ToggleGroup type="single" variant="segmented" fill value="choose" onValueChange={chooseSource} aria-label={i18n._({ id: "Voice source", message: "Voice source" })}>
            <ToggleGroupItem value="choose">{i18n._({ id: "Choose Voice", message: "Choose Voice" })}</ToggleGroupItem>
            <ToggleGroupItem value="clone">{i18n._({ id: "Create / Clone", message: "Create / Clone" })}</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><Select value={selectedValue} onValueChange={setVoiceId} disabled={!choices}>
              <SelectTrigger shape="pill" width="full" aria-label={i18n._({ id: "Voice", message: "Voice" })}><SelectValue /></SelectTrigger>
              <SelectContent>{(choices?.options ?? [{ value: selectedValue, label: i18n._({ id: "Loading voices", message: "Loading voices" }) }]).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select></div>
            <Button variant="outline" shape="pill" disabled={!previewId || (playing && preview.busy)} onClick={() => playing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId)}>{playing && !preview.busy ? i18n._({ id: "Stop", message: "Stop" }) : i18n._({ id: "Preview", message: "Preview" })}</Button>
          </div>
          {voices.isError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={flowErrorText(voices.error)} /> : null}
          {choices?.notice ? <p className="text-sm text-muted-foreground">{choices.notice}</p> : null}
          {preview.error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={preview.error} /> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        </DialogSection>
        <DialogSection title={i18n._({ id: "Personality", message: "Personality" })} icon={<Heart aria-hidden="true" />}>
          <ToggleGroup type="single" variant="chip" wrap value={personality} onValueChange={(next) => { if (next) setPersonality(next as CompanionPersonality); }} aria-label={i18n._({ id: "Personality", message: "Personality" })}>
            {PERSONALITIES().map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <Textarea aria-label={i18n._({ id: "Personality notes", message: "Personality notes" })} shape="rounded" maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={i18n._({ id: "How should your synth behave, speak, and interact? (Optional)", message: "How should your synth behave, speak, and interact? (Optional)" })} />
        </DialogSection>
        <DialogSection title={i18n._({ id: "Style", message: "Style" })}>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{i18n._({ id: "Dials", message: "Dials" })}</p>
            {dialRows.map(({ key, label, value }) => <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm">{label}: {value ?? ""}</span>
              <Switch aria-label={i18n._({ id: "Pin dial: {dial}", message: "Pin dial: {dial}", values: { dial: label } })} checked={pins.dials.includes(key)} disabled={!saved.data || saving} onCheckedChange={() => void togglePin("dials", key)} />
            </div>)}
            <p className="text-sm font-medium">{i18n._({ id: "Examples", message: "Examples" })}</p>
            {examples.map((phrase) => <div key={phrase} className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-sm">{phrase}</p>{saved.data?.synth?.phrase_sources[phrase] ? <p className="text-xs text-muted-foreground">{saved.data.synth.phrase_sources[phrase]}</p> : null}</div>
              <Switch aria-label={i18n._({ id: "Pin example: {phrase}", message: "Pin example: {phrase}", values: { phrase } })} checked={pins.examples.includes(phrase)} disabled={!saved.data || saving || phrase.length > 60} onCheckedChange={() => void togglePin("examples", phrase)} />
              {phrase.length > 60 ? <p className="text-xs text-muted-foreground">{i18n._({ id: "This example is too long to pin. Shorten it to 60 characters or fewer.", message: "This example is too long to pin. Shorten it to 60 characters or fewer." })}</p> : null}
            </div>)}
            {pinError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={pinError} /> : null}
          </div>
        </DialogSection>
        <DialogSection title={i18n._({ id: "Backstory", message: "Backstory" })} icon={<Book aria-hidden="true" />} aside={<Button variant="secondary" shape="pill" disabled={generating || loading} onClick={() => void generate()}><Sparkles aria-hidden="true" />{generating ? i18n._({ id: "Writing", message: "Writing" }) : i18n._({ id: "Generate", message: "Generate" })}</Button>}>
          <Textarea aria-label={i18n._({ id: "Backstory", message: "Backstory" })} shape="rounded" maxLength={BACKSTORY_MAX} value={backstory} onChange={(e) => setBackstory(e.target.value)} placeholder={i18n._({ id: "Who is your synth? Describe their history, experiences, interests, occupation, relationships, and personal story...", message: "Who is your synth? Describe their history, experiences, interests, occupation, relationships, and personal story..." })} />
          <p className="text-sm text-muted-foreground">{i18n._({ id: "Generate a suggested backstory or write your own. You can edit it anytime.", message: "Generate a suggested backstory or write your own. You can edit it anytime." })}</p>
        </DialogSection>
      </div>
      <DialogSection title={i18n._({ id: "Synth Preview", message: "Synth Preview" })} aside={name}>
        <CompanionStage surface="panel" frame="strong" transparency="checker" name={name || i18n._({ id: "Your synth", message: "Your synth" })} mode="idle" showHeader={false} talk={null}
          character={portrait ? <img src={portrait} alt={i18n._({ id: "{name}, synth preview", message: "{name}, synth preview", values: { name: name || i18n._({ id: "Your synth", message: "Your synth" }) } })} draggable={false} className="aspect-square max-h-96 w-full object-contain" /> : <p className="p-6 text-center text-muted-foreground">{i18n._({ id: "Your synth will appear here", message: "Your synth will appear here" })}</p>}
          actions={[
            { id: "test", label: i18n._({ id: "Test Conversation", message: "Test Conversation" }), onSelect: () => { window.open(`/chat?try=${encodeURIComponent(companionId)}`, "_blank", "noopener"); } },
            { id: "save", label: saving ? i18n._({ id: "Saving", message: "Saving" }) : i18n._({ id: "Save Synth", message: "Save Synth" }), primary: true, disabled: saving || loading, onSelect: () => void save() },
          ]} />
        {error.text ? <div className="flex flex-col gap-2">
          <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error.text} />
          {error.back ? <Button variant="outline" shape="pill" onClick={() => onGoTo(error.back === "look" ? 0 : 1)}>{error.back === "look" ? i18n._({ id: "Go to Create Character", message: "Go to Create Character" }) : i18n._({ id: "Go to Animate Character", message: "Go to Animate Character" })}</Button> : null}
        </div> : null}
      </DialogSection>
    </DialogBody>
    <DialogFooter align="between">
      <Button variant="outline" shape="pill" onClick={onBack}><Back aria-hidden="true" />{i18n._({ id: "Back", message: "Back" })}</Button>
      <span className="text-sm text-muted-foreground">{i18n._({ id: "All settings can be changed later.", message: "All settings can be changed later." })}</span>
    </DialogFooter>
    <Dialog open={cloning} onOpenChange={(open) => { if (!cloneBusy) setCloning(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n._({ id: "Add a voice", message: "Add a voice" })}</DialogTitle>
          <DialogDescription>{i18n._({ id: "Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot.", message: "Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot." })}</DialogDescription>
        </DialogHeader>
        <AddVoiceForm onBusyChange={setCloneBusy} onCancel={() => setCloning(false)} onMade={(made) => { setCloning(false); setNotice(i18n._({ id: "{made} is ready. Pick it from the list and press Preview to hear it.", message: "{made} is ready. Pick it from the list and press Preview to hear it.", values: { made } })); void client.invalidateQueries({ queryKey: ["stack-voices"] }); }} />
      </DialogContent>
    </Dialog>
    </>
  );
}
