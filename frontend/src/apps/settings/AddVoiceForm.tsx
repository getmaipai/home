import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { ApiError } from "@/lib/api";
import { householdVoicesApi } from "@/lib/householdVoicesApi";

const FIELD = "flex flex-col gap-1";
const HELP = "text-sm text-muted-foreground";

/** The form inside the Add voice dialog (VOICES-04): name, a WAV, MP3 or FLAC clip of 6 to 30 seconds, and optional liveliness and pitch.
 * The dialog itself is the kit's, rendered where it is used (design rule 9). */
export function AddVoiceForm({ onCancel, onMade, onBusyChange }: { onCancel: () => void; onMade: (name: string) => void; onBusyChange: (busy: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [clip, setClip] = useState<File | undefined>();
  const [temperature, setTemperature] = useState("");
  const [pitch, setPitch] = useState("");
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange(value); };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !clip || busy) return;
    const voiceName = name.trim();
    setBusy(true); setError(null);
    try {
      await householdVoicesApi.make({ name: voiceName, clip, temperature: temperature === "" ? undefined : Number(temperature), pitchSemitones: pitch === "" ? undefined : Number(pitch) });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
      setBusy(false);
      onMade(voiceName);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Could not make this voice. Try again.");
      setBusy(false);
    }
  }

  return <form id="add-voice-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
    <div className={FIELD}><label htmlFor="add-voice-name" className="text-base">Name</label><Input id="add-voice-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
    <div className={FIELD}><label htmlFor="add-voice-recording" className="text-base">Recording</label><Input id="add-voice-recording" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setClip(event.target.files?.[0])} disabled={busy} /></div>
    <div className={FIELD}><label htmlFor="add-voice-liveliness" className="text-base">Liveliness (optional)</label><Input id="add-voice-liveliness" type="number" min={0.1} max={2} step={0.05} placeholder="Engine default" value={temperature} onChange={(event) => setTemperature(event.target.value)} disabled={busy} /><p className={HELP}>0.1 to 2. Higher is livelier and also raises the pitch.</p></div>
    <div className={FIELD}><label htmlFor="add-voice-pitch" className="text-base">Pitch (optional)</label><Input id="add-voice-pitch" type="number" min={-12} max={12} step={0.5} placeholder="0" value={pitch} onChange={(event) => setPitch(event.target.value)} disabled={busy} /><p className={HELP}>Semitones, -12 to 12. A negative number lowers the voice.</p></div>
    <p className={HELP}>You are responsible for having the right to use this voice.</p>
    {error ? <p role="alert" className="text-base text-destructive">{error}</p> : null}
    {busy ? <div className="flex items-center gap-3"><Progress mode="spinner" label="Making the voice" /><p className={HELP}>Making the voice. This can take up to a minute the first time.</p></div> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" disabled={!name.trim() || !clip || busy}>Make voice</Button>
    </div>
  </form>;
}
