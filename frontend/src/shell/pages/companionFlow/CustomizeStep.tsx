import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogBody, DialogFooter, DialogSection, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { CompanionStage } from "@maipai/ui/src/elements/companion-stage";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type CompanionEditable, type CompanionPersonality } from "@/lib/api";
import { AddVoiceForm } from "@/apps/settings/AddVoiceForm";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { lookKey } from "@/shell/pages/companionFlow/CreateCharacterStep";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

const PERSONALITIES: Array<{ id: CompanionPersonality; label: string }> = [
  { id: "friendly", label: "Friendly" }, { id: "funny", label: "Funny" }, { id: "calm", label: "Calm" },
  { id: "professional", label: "Professional" }, { id: "playful", label: "Playful" }, { id: "custom", label: "Custom" },
];

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
  }, [saved.data]);
  useEffect(() => { const unsubscribe = voicePreviewPlayer.subscribe(setPreview); return () => { unsubscribe(); voicePreviewPlayer.stop(); }; }, []);

  const list = voices.data?.voices ?? [];
  const choices = list.length ? voiceChoices(playableVoices(list), voiceId, [voiceId]) : null;
  const selectedValue = choices?.selected.value ?? voiceId;
  const previewId = choices ? previewIdFor(choices.selected, list) : null;
  const playing = previewId !== null && preview.voiceId === previewId;
  const portrait = look.data?.versions.find((v) => v.id === (look.data?.rest ?? ""))?.url ?? look.data?.versions[look.data.versions.length - 1]?.url ?? null;
  const loading = saved.isLoading;

  function chooseSource(next: string) {
    if (next === "clone") { setNotice(""); setCloning(true); }
  }
  async function generate() {
    setError({ text: "", back: null }); setGenerating(true);
    try {
      const hint = notes.trim() || (personality === "custom" ? "" : PERSONALITIES.find((p) => p.id === personality)!.label);
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
        <DialogSection title="Voice" icon={<Mic aria-hidden="true" />}>
          <ToggleGroup type="single" variant="segmented" fill value="choose" onValueChange={chooseSource} aria-label="Voice source">
            <ToggleGroupItem value="choose">Choose Voice</ToggleGroupItem>
            <ToggleGroupItem value="clone">Create / Clone</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><Select value={selectedValue} onValueChange={setVoiceId} disabled={!choices}>
              <SelectTrigger shape="pill" width="full" aria-label="Voice"><SelectValue /></SelectTrigger>
              <SelectContent>{(choices?.options ?? [{ value: selectedValue, label: "Loading voices" }]).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select></div>
            <Button variant="outline" shape="pill" disabled={!previewId || (playing && preview.busy)} onClick={() => playing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId)}>{playing && !preview.busy ? "Stop" : "Preview"}</Button>
          </div>
          {voices.isError ? <p role="alert" className="text-sm text-destructive">{flowErrorText(voices.error)}</p> : null}
          {choices?.notice ? <p className="text-sm text-muted-foreground">{choices.notice}</p> : null}
          {preview.error ? <p role="alert" className="text-sm text-destructive">{preview.error}</p> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        </DialogSection>
        <DialogSection title="Personality" icon={<Heart aria-hidden="true" />}>
          <ToggleGroup type="single" variant="chip" wrap value={personality} onValueChange={(next) => { if (next) setPersonality(next as CompanionPersonality); }} aria-label="Personality">
            {PERSONALITIES.map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <Textarea aria-label="Personality notes" shape="rounded" maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How should your companion behave, speak, and interact? (Optional)" />
        </DialogSection>
        <DialogSection title="Backstory" icon={<Book aria-hidden="true" />} aside={<Button variant="secondary" shape="pill" disabled={generating || loading} onClick={() => void generate()}><Sparkles aria-hidden="true" />{generating ? "Writing" : "Generate"}</Button>}>
          <Textarea aria-label="Backstory" shape="rounded" maxLength={BACKSTORY_MAX} value={backstory} onChange={(e) => setBackstory(e.target.value)} placeholder="Who is your companion? Describe their history, experiences, interests, occupation, relationships, and personal story..." />
          <p className="text-sm text-muted-foreground">Generate a suggested backstory or write your own. You can edit it anytime.</p>
        </DialogSection>
      </div>
      <DialogSection title="Companion Preview" aside={name}>
        <CompanionStage surface="panel" frame="strong" transparency="checker" name={name || "Your companion"} mode="idle" showHeader={false} talk={null}
          character={portrait ? <img src={portrait} alt={`${name || "Your companion"}, companion preview`} draggable={false} className="aspect-square max-h-96 w-full object-contain" /> : <p className="p-6 text-center text-muted-foreground">Your companion will appear here</p>}
          actions={[
            { id: "test", label: "Test Conversation", onSelect: () => { window.open(`/chat?try=${encodeURIComponent(companionId)}`, "_blank", "noopener"); } },
            { id: "save", label: saving ? "Saving" : "Save Companion", primary: true, disabled: saving || loading, onSelect: () => void save() },
          ]} />
        {error.text ? <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive">{error.text}</p>
          {error.back ? <Button variant="outline" shape="pill" onClick={() => onGoTo(error.back === "look" ? 0 : 1)}>{error.back === "look" ? "Go to Create Character" : "Go to Animate Character"}</Button> : null}
        </div> : null}
      </DialogSection>
    </DialogBody>
    <DialogFooter align="between">
      <Button variant="outline" shape="pill" onClick={onBack}><Back aria-hidden="true" />Back</Button>
      <span className="text-sm text-muted-foreground">All settings can be changed later.</span>
    </DialogFooter>
    <Dialog open={cloning} onOpenChange={(open) => { if (!cloneBusy) setCloning(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a voice</DialogTitle>
          <DialogDescription>Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot.</DialogDescription>
        </DialogHeader>
        <AddVoiceForm onBusyChange={setCloneBusy} onCancel={() => setCloning(false)} onMade={(made) => { setCloning(false); setNotice(`${made} is ready. Pick it from the list and press Preview to hear it.`); void client.invalidateQueries({ queryKey: ["stack-voices"] }); }} />
      </DialogContent>
    </Dialog>
    </>
  );
}
