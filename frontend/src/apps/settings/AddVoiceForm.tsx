import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import { householdVoicesApi, INSPIRED_LEVELS, inspiredLevelLabel, type InspiredLevel } from "@/lib/householdVoicesApi";
import { errorLine } from "@/lib/hubReachability";

const FIELD = "flex flex-col gap-1";
const HELP = "text-sm text-muted-foreground";

/** The form inside the Add voice dialog (VOICES-04): name, a WAV, MP3 or FLAC clip of 6 to 30 seconds, and optional liveliness and pitch.
 * The dialog itself is the kit's, rendered where it is used (design rule 9). */
export function AddVoiceForm({ onCancel, onMade, onBusyChange, canTune = true, minor = false, inspired = false }: { onCancel: () => void; onMade: (name: string) => void; onBusyChange: (busy: boolean) => void; canTune?: boolean; minor?: boolean; inspired?: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [clip, setClip] = useState<File | undefined>();
  const [temperature, setTemperature] = useState("");
  const [pitch, setPitch] = useState("");
  const [level, setLevel] = useState<InspiredLevel>("different");
  const [baseId, setBaseId] = useState("none");
  const [sampling, setSampling] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voices = useQuery({ queryKey: ["household-voices"], queryFn: householdVoicesApi.list, enabled: inspired, staleTime: 30_000 });
  const baseVoices = voices.data?.voices ?? [];
  const baseLabel = (id: string) => id === "none" ? i18n._({ id: "No other voice", message: "No other voice" }) : baseVoices.find((voice) => voice.id === id)?.label ?? id;
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange(value); };

  async function preview() {
    if (!clip || sampling || busy) return;
    setSampling(true); setError(null);
    try {
      const blob = await householdVoicesApi.preview({ clip, inspiredLevel: level, baseVoiceId: baseId === "none" ? undefined : baseId });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : i18n._({ id: "Could not play a sample. Try again.", message: "Could not play a sample. Try again." }));
    } finally { setSampling(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !clip || busy) return;
    const voiceName = name.trim();
    setBusy(true); setError(null);
    try {
      await householdVoicesApi.make({ name: voiceName, clip, temperature: !inspired && canTune && temperature !== "" ? Number(temperature) : undefined, pitchSemitones: !inspired && canTune && pitch !== "" ? Number(pitch) : undefined, inspiredLevel: inspired ? level : undefined, baseVoiceId: inspired && baseId !== "none" ? baseId : undefined });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
      setBusy(false);
      onMade(voiceName);
    } catch (cause) {
      setError(errorLine(cause, cause instanceof Error ? cause.message : i18n._({ id: "Could not make this voice. Try again.", message: "Could not make this voice. Try again." })));
      setBusy(false);
    }
  }

  return <form id="add-voice-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
    <div className={FIELD}><label htmlFor="add-voice-name" className="text-base">{i18n._({ id: "Name", message: "Name" })}</label><Input id="add-voice-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
    <div className={FIELD}><label htmlFor="add-voice-recording" className="text-base">{i18n._({ id: "Recording", message: "Recording" })}</label><Input id="add-voice-recording" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setClip(event.target.files?.[0])} disabled={busy} /></div>
    {inspired ? <div className={FIELD}>
      <span className="text-base">{i18n._({ id: "How different from the original", message: "How different from the original" })}</span>
      <Select aria-label={i18n._({ id: "How different from the original", message: "How different from the original" })} value={level} options={INSPIRED_LEVELS} getLabel={(id) => inspiredLevelLabel(id as InspiredLevel)} onValueChange={(id) => setLevel(id as InspiredLevel)} disabled={busy} />
      <p className={HELP}>{i18n._({ id: "Different sounds like a relative of the voice. Very different sounds like someone else with a similar feel. Lower and Much lower make the voice deeper.", message: "Different sounds like a relative of the voice. Very different sounds like someone else with a similar feel. Lower and Much lower make the voice deeper." })}</p>
      <div><Button type="button" variant="outline" onClick={() => void preview()} disabled={!clip || sampling || busy}>{sampling ? i18n._({ id: "Playing a sample", message: "Playing a sample" }) : i18n._({ id: "Preview", message: "Preview" })}</Button></div>
    </div> : null}
    {inspired && baseVoices.length > 0 ? <div className={FIELD}>
      <span className="text-base">{i18n._({ id: "Blend with (optional)", message: "Blend with (optional)" })}</span>
      <Select aria-label={i18n._({ id: "Blend with (optional)", message: "Blend with (optional)" })} value={baseId} options={["none", ...baseVoices.map((voice) => voice.id)]} getLabel={baseLabel} onValueChange={setBaseId} disabled={busy} />
      <p className={HELP}>{i18n._({ id: "Mixes the new voice with a voice already made at home.", message: "Mixes the new voice with a voice already made at home." })}</p>
    </div> : null}
    {canTune && !inspired ? <>
    <div className={FIELD}><label htmlFor="add-voice-liveliness" className="text-base">{i18n._({ id: "Liveliness (optional)", message: "Liveliness (optional)" })}</label><Input id="add-voice-liveliness" type="number" min={0.1} max={2} step={0.05} placeholder={i18n._({ id: "Engine default", message: "Engine default" })} value={temperature} onChange={(event) => setTemperature(event.target.value)} disabled={busy} /><p className={HELP}>{i18n._({ id: "0.1 to 2. Higher is livelier and also raises the pitch.", message: "0.1 to 2. Higher is livelier and also raises the pitch." })}</p></div>
    <div className={FIELD}><label htmlFor="add-voice-pitch" className="text-base">{i18n._({ id: "Pitch (optional)", message: "Pitch (optional)" })}</label><Input id="add-voice-pitch" type="number" min={-12} max={12} step={0.5} placeholder="0" value={pitch} onChange={(event) => setPitch(event.target.value)} disabled={busy} /><p className={HELP}>{i18n._({ id: "Semitones, -12 to 12. A negative number lowers the voice.", message: "Semitones, -12 to 12. A negative number lowers the voice." })}</p></div>
    </> : null}
    {inspired ? <p className={HELP}>{i18n._({ id: "This makes a new voice based on the recording. It is not a copy of the voice.", message: "This makes a new voice based on the recording. It is not a copy of the voice." })}</p> : null}
    <p className={HELP}>{minor ? i18n._({ id: "Only use your own voice, or the voice of someone who said yes.", message: "Only use your own voice, or the voice of someone who said yes." }) : i18n._({ id: "You are responsible for having the right to use this voice.", message: "You are responsible for having the right to use this voice." })}</p>
    {error ? <p role="alert" className="text-base text-destructive">{error}</p> : null}
    {busy ? <div className="flex items-center gap-3"><Progress mode="spinner" label={i18n._({ id: "Making the voice", message: "Making the voice" })} /><p className={HELP}>{i18n._({ id: "Making the voice. This can take up to a minute the first time.", message: "Making the voice. This can take up to a minute the first time." })}</p></div> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
      <Button type="submit" disabled={!name.trim() || !clip || busy}>{inspired ? i18n._({ id: "Make Inspired voice", message: "Make Inspired voice" }) : i18n._({ id: "Make voice", message: "Make voice" })}</Button>
    </div>
  </form>;
}
