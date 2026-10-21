import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { ApiError } from "@/lib/api";
import { householdVoicesApi, type HouseholdVoice } from "@/lib/householdVoicesApi";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";

function settingsLine(voice: HouseholdVoice) {
  const parts: string[] = [];
  if (voice.temperature !== undefined) parts.push(`Liveliness ${voice.temperature}`);
  if (voice.pitchSemitones) parts.push(`Pitch ${voice.pitchSemitones > 0 ? "+" : ""}${voice.pitchSemitones} semitones`);
  return parts.join(" · ");
}

export function HouseholdVoicesSection() {
  const queryClient = useQueryClient();
  const voicesQuery = useQuery({ queryKey: ["household-voices"], queryFn: householdVoicesApi.list });
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  const [name, setName] = useState("");
  const [clip, setClip] = useState<File | undefined>();
  const [temperature, setTemperature] = useState("");
  const [pitch, setPitch] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const [nameKey, setNameKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);

  async function makeVoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !clip || busy) return;
    const voiceName = name.trim();
    setBusy(true); setError(null); setStatus(null);
    try {
      await householdVoicesApi.make({ name: voiceName, clip, temperature: temperature === "" ? undefined : Number(temperature), pitchSemitones: pitch === "" ? undefined : Number(pitch) });
      setName(""); setClip(undefined); setTemperature(""); setPitch(""); setStatus(`${voiceName} is ready. Choose it in the list above or on a robot's page.`);
      setFileKey((key) => key + 1);
      setNameKey((key) => key + 1);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Could not make this voice.");
    } finally { setBusy(false); }
  }

  async function deleteVoice(id: string) {
    setError(null); setStatus(null);
    try {
      await householdVoicesApi.remove(id);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Could not delete this voice.");
    }
  }

  const muted = "text-base text-[var(--muted-foreground)]";
  const field = "flex flex-col gap-1";
  return <section className="flex flex-col gap-4 border-t border-[var(--border)] pt-6">
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-medium">Voices made at home</h2>
      <p className={muted}>Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot.</p>
    </div>
    {voicesQuery.data?.voices.length ? <ul className="flex flex-col divide-y divide-[var(--border)]">{voicesQuery.data.voices.map((voice) => {
      const testing = preview.voiceId === voice.id;
      const line = settingsLine(voice);
      return <li key={voice.id} className="flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{voice.label}</span>
          <span className="text-sm text-[var(--muted-foreground)]">Made by {voice.creatorName}{line ? ` · ${line}` : ""}</span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => testing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(voice.id)}>{testing ? "Stop" : "Test"}</Button>
          <Button type="button" variant="outline" onClick={() => void deleteVoice(voice.id)}>Delete</Button>
        </div>
      </li>;
    })}</ul> : <p className={muted}>No voices made yet.</p>}
    {preview.error ? <p role="alert" className="text-base text-[var(--destructive)]">{preview.error}</p> : null}
    {error ? <p role="alert" className="text-base text-[var(--destructive)]">{error}</p> : null}
    <form key={fileKey} onSubmit={(event) => void makeVoice(event)} className="flex max-w-sm flex-col gap-4 border-t border-[var(--border)] pt-4">
      <h3 className="text-base font-medium">Make a voice</h3>
      <div className={field}><label htmlFor="household-voice-name" className="text-base">Name</label><Input key={nameKey} id="household-voice-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className={field}><label htmlFor="household-voice-recording" className="text-base">Recording</label><Input id="household-voice-recording" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setClip(event.target.files?.[0])} /></div>
      <div className={field}><label htmlFor="household-voice-liveliness" className="text-base">Liveliness (optional)</label><Input id="household-voice-liveliness" type="number" min={0.1} max={2} step={0.05} placeholder="Engine default" value={temperature} onChange={(event) => setTemperature(event.target.value)} /><p className="text-sm text-[var(--muted-foreground)]">0.1 to 2. Higher is livelier and also raises the pitch.</p></div>
      <div className={field}><label htmlFor="household-voice-pitch" className="text-base">Pitch (optional)</label><Input id="household-voice-pitch" type="number" min={-12} max={12} step={0.5} placeholder="0" value={pitch} onChange={(event) => setPitch(event.target.value)} /><p className="text-sm text-[var(--muted-foreground)]">Semitones, -12 to 12. A negative number lowers the voice.</p></div>
      <p className={muted}>You are responsible for having the right to use this voice.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!name.trim() || !clip || busy}>Make voice</Button>
        {busy ? <Progress mode="spinner" label="Making the voice" /> : null}
      </div>
      {busy ? <p className={muted}>Making the voice. This can take up to a minute the first time.</p> : null}
    </form>
    {status ? <p role="status" className="text-base text-[var(--primary)]">{status}</p> : null}
  </section>;
}
