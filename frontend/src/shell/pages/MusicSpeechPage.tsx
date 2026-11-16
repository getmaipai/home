import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Player } from "@maipai/ui/src/primitives/Player";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { requestJson } from "@/lib/api";

export type SpeechVoice = { id: string; label: string; kind: "preset" | "clip"; engine: "fish-audio-drama-3" | "chatterbox-turbo"; tags: string[] };
type SpeechOptions = { voices: SpeechVoice[] };
const active = (card: MusicCard) => card.state === "queued" || card.state === "running";

export function MusicSpeechPage() {
  const client = useQueryClient();
  const options = useQuery({ queryKey: ["voiceover-options"], queryFn: () => requestJson<SpeechOptions>("/api/voiceover/options"), staleTime: 30_000 });
  const speeches = useQuery({ queryKey: ["music-speeches"], queryFn: () => musicApi.listSpeeches(), refetchInterval: (query) => query.state.data?.some(active) ? 2500 : 20_000 });
  const [script, setScript] = useState("");
  const [delivery, setDelivery] = useState("");
  const [voice, setVoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sample, setSample] = useState<{ id: string; url: string } | null>(null);
  const voices = options.data?.voices ?? [];
  const selected = voices.find((item) => item.id === voice) ?? voices[0];
  useEffect(() => () => { if (sample?.url) URL.revokeObjectURL(sample.url); }, [sample?.url]);
  const playSample = async (id: string) => {
    setProblem("");
    try {
      const response = await fetch(`/api/voice/voices/${encodeURIComponent(id)}/preview`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Sample unavailable");
      const url = URL.createObjectURL(await response.blob());
      setSample((old) => { if (old) URL.revokeObjectURL(old.url); return { id, url }; });
    } catch { setProblem(i18n._({ id: "That voice sample is not available right now.", message: "That voice sample is not available right now." })); }
  };
  const make = async () => {
    if (!script.trim() || !selected || busy) return;
    setBusy(true); setProblem("");
    try {
      await musicApi.makeSpeech({ script: script.trim(), voice: selected.id, ...(delivery.trim() ? { delivery: delivery.trim() } : {}) });
      setScript("");
      await client.invalidateQueries({ queryKey: ["music-speeches"] });
    } catch { setProblem(i18n._({ id: "Home could not start that recording. Check the script and try again.", message: "Home could not start that recording. Check the script and try again." })); }
    finally { setBusy(false); }
  };
  return <section className="flex flex-col gap-6 px-4 py-4 lg:px-0" data-testid="music-speech-page">
    <header className="flex flex-col gap-1"><h1 className="text-title">{i18n._({ id: "Speech", message: "Speech" })}</h1><p className="text-muted-foreground">{i18n._({ id: "Turn a script into spoken audio in a voice you can use.", message: "Turn a script into spoken audio in a voice you can use." })}</p></header>
    {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="grid gap-2"><Label htmlFor="speech-script">{i18n._({ id: "Script", message: "Script" })}</Label><Textarea id="speech-script" rows={8} maxLength={4000} value={script} onChange={(event) => setScript(event.currentTarget.value)} placeholder={i18n._({ id: "Write the words to speak.", message: "Write the words to speak." })} /></div>
      <div className="grid gap-2"><Label htmlFor="speech-voice">{i18n._({ id: "Voice", message: "Voice" })}</Label>
        <Select value={selected?.id ?? ""} onValueChange={(next) => setVoice(next)} disabled={!voices.length}><SelectTrigger id="speech-voice"><SelectValue placeholder={i18n._({ id: "Choose a voice", message: "Choose a voice" })} /></SelectTrigger><SelectContent>{voices.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}{item.kind === "clip" ? i18n._({ id: " · Household voice", message: " · Household voice" }) : ""}</SelectItem>)}</SelectContent></Select>
        {selected ? <Button type="button" variant="outline" onClick={() => void playSample(selected.id)}>{i18n._({ id: "Play voice sample", message: "Play voice sample" })}</Button> : null}
        {sample && sample.id === selected?.id ? <audio controls src={sample.url} aria-label={i18n._({ id: "Voice sample", message: "Voice sample" })}><track kind="captions" /></audio> : null}
      </div>
      <div className="grid gap-2"><Label htmlFor="speech-delivery">{i18n._({ id: "Delivery", message: "Delivery" })}</Label><Input id="speech-delivery" maxLength={240} value={delivery} onChange={(event) => setDelivery(event.currentTarget.value)} placeholder={i18n._({ id: "For example, whisper softly with a short pause.", message: "For example, whisper softly with a short pause." })} /></div>
      <Button type="button" disabled={!script.trim() || !selected || busy} onClick={() => void make()}>{busy ? i18n._({ id: "Starting speech…", message: "Starting speech…" }) : i18n._({ id: "Make speech", message: "Make speech" })}</Button>
    </div>
    <div className="flex flex-col gap-3" data-testid="your-speech"><h2 className="text-section">{i18n._({ id: "Your speech", message: "Your speech" })}</h2>
      {speeches.isError ? <p role="alert">{i18n._({ id: "Your speech could not be loaded.", message: "Your speech could not be loaded." })}</p> : null}
      {!speeches.data?.length && !speeches.isLoading ? <p className="text-muted-foreground">{i18n._({ id: "Your speech recordings will appear here.", message: "Your speech recordings will appear here." })}</p> : null}
      {speeches.data?.map((card) => <SpeechResult key={card.id} card={card} onSave={async () => { await musicApi.saveSpeech(card.id); await client.invalidateQueries({ queryKey: ["music-speeches"] }); }} />)}
    </div>
  </section>;
}

function SpeechResult({ card, onSave }: { card: MusicCard; onSave: () => Promise<void> }) {
  const file = card.versions[0];
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  return <article className="flex max-w-3xl flex-col gap-2 border-b border-border py-3" data-testid="speech-result">
    <p className="font-medium">{card.speech?.voice_name ?? i18n._({ id: "Speech recording", message: "Speech recording" })}</p>
    {card.state === "done" && file ? <Player src={file.url} kind="audio" layout="audio" title={card.speech?.voice_name ?? "Speech"} /> : <p className="text-muted-foreground" role="status">{card.stage_label}</p>}
    {card.state === "failed" && card.error_line ? <p role="alert">{card.error_line}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={card.state !== "done" || saved || saving} onClick={() => { setSaving(true); void onSave().then(() => setSaved(true)).finally(() => setSaving(false)); }}>{saved ? i18n._({ id: "Saved", message: "Saved" }) : saving ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save", message: "Save" })}</Button>{file && card.state === "done" ? <Button asChild variant="outline"><Link to={`/files?file=${encodeURIComponent(file.id)}`}>{i18n._({ id: "Use in a video", message: "Use in a video" })}</Link></Button> : null}</div>
  </article>;
}
