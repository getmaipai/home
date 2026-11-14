import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Select } from "@maipai/ui/src/primitives/Select";
import { householdVoicesApi, INSPIRED_LEVELS, type HouseholdVoice, inspiredLevelLabel, type InspiredLevel } from "@/lib/householdVoicesApi";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const FIELD = "flex flex-col gap-1";
const HELP = "text-sm text-muted-foreground";

/** The form inside the Add voice dialog (VOICES-04): name, a WAV, MP3 or FLAC clip of 6 to 30 seconds, and optional liveliness and pitch.
 * The dialog itself is the kit's, rendered where it is used (design rule 9). */
export function AddVoiceForm({ onCancel, onMade, onBusyChange, canTune = true, minor = false, inspired = false, edit }: { edit?: HouseholdVoice; onCancel: () => void; onMade: (name: string) => void; onBusyChange: (busy: boolean) => void; canTune?: boolean; minor?: boolean; inspired?: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(edit?.label ?? "");
  const [clip, setClip] = useState<File | undefined>();
  const [reduceNoise, setReduceNoise] = useState(!edit);
  const [isolateVoice, setIsolateVoice] = useState(false);
  const [reduceEcho, setReduceEcho] = useState(false);
  const [whisperClip, setWhisperClip] = useState<File | undefined>();
  const [angerClip, setAngerClip] = useState<File | undefined>();
  const [extraClips, setExtraClips] = useState<(File | undefined)[]>([undefined, undefined]);
  const [temperature, setTemperature] = useState(edit?.temperature !== undefined ? String(edit.temperature) : "");
  const [pitch, setPitch] = useState(edit?.pitchSemitones !== undefined ? String(edit.pitchSemitones) : "");
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
    if (!name.trim() || (!clip && !edit) || busy) return;
    const voiceName = name.trim();
    setBusy(true); setError(null);
    try {
      if (edit) {
        const tuned = canTune && !inspired;
        await householdVoicesApi.update(edit.id, { clip, extraClips: extraClips.filter((item): item is File => item !== undefined), whisperClip, angerClip, reduceNoise, reduceEcho, isolateVoice, temperature: tuned && temperature !== "" ? Number(temperature) : undefined, pitchSemitones: tuned && pitch !== "" ? Number(pitch) : undefined });
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
        setBusy(false);
        onMade(voiceName);
        return;
      }
      if (!clip) return;
      await householdVoicesApi.make({ name: voiceName, clip, isolateVoice: inspired ? undefined : isolateVoice, reduceNoise: inspired ? undefined : reduceNoise, reduceEcho: inspired ? undefined : reduceEcho, whisperClip: inspired ? undefined : whisperClip, angerClip: inspired ? undefined : angerClip, extraClips: inspired ? undefined : extraClips.filter((item): item is File => item !== undefined), temperature: !inspired && canTune && temperature !== "" ? Number(temperature) : undefined, pitchSemitones: !inspired && canTune && pitch !== "" ? Number(pitch) : undefined, inspiredLevel: inspired ? level : undefined, baseVoiceId: inspired && baseId !== "none" ? baseId : undefined });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
      setBusy(false);
      onMade(voiceName);
    } catch (cause) {
      setError(errorLine(cause, cause instanceof Error ? cause.message : i18n._({ id: "Could not make this voice. Try again.", message: "Could not make this voice. Try again." })));
      setBusy(false);
    }
  }

  return <form id="add-voice-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
    <div className={FIELD}><label htmlFor="add-voice-name" className="text-base">{i18n._({ id: "Name", message: "Name" })}</label><Input id="add-voice-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={busy || !!edit} /></div>
    <div className={FIELD}><label htmlFor="add-voice-recording" className="text-base">{i18n._({ id: edit ? "Replace recording (optional)" : "Recording", message: edit ? "Replace recording (optional)" : "Recording" })}</label><Input id="add-voice-recording" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setClip(event.target.files?.[0])} disabled={busy} /></div>
    {!inspired ? [0, 1].map((slot) => <div key={slot} className={FIELD}><label htmlFor={`add-voice-recording-${slot + 2}`} className="text-base">{slot === 0 ? i18n._({ id: "Second recording (optional)", message: "Second recording (optional)" }) : i18n._({ id: "Third recording (optional)", message: "Third recording (optional)" })}</label><Input id={`add-voice-recording-${slot + 2}`} type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setExtraClips((old) => old.map((item, index) => index === slot ? event.target.files?.[0] : item))} disabled={busy} /></div>) : null}
    {!inspired ? <p className={HELP}>{i18n._({ id: "Aim for 20 to 28 seconds of clear speech in total, with no music. Up to 3 normal clips are joined into one.", message: "Aim for 20 to 28 seconds of clear speech in total, with no music. Up to 3 normal clips are joined into one." })}</p> : null}
    {!inspired ? <>
      <div className={FIELD}><label htmlFor="add-voice-whisper" className="text-body">{i18n._({ id: "Whisper recording (optional)", message: "Whisper recording (optional)" })}</label><Input id="add-voice-whisper" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setWhisperClip(event.target.files?.[0])} disabled={busy} /></div>
      <div className={FIELD}><label htmlFor="add-voice-anger" className="text-body">{i18n._({ id: "Angry recording (optional)", message: "Angry recording (optional)" })}</label><Input id="add-voice-anger" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" onChange={(event) => setAngerClip(event.target.files?.[0])} disabled={busy} /></div>
      <p className={HELP}>{i18n._({ id: "Whisper and angry recordings, 10 to 25 seconds each, are the voice's own styles. Without a whisper one, Home makes it for you.", message: "Whisper and angry recordings, 10 to 25 seconds each, are the voice's own styles. Without a whisper one, Home makes it for you." })}</p>
    </> : null}
    {!inspired ? <div className={FIELD}>
      <label className="flex items-center gap-2 text-body"><Checkbox checked={isolateVoice} onCheckedChange={(value) => setIsolateVoice(value === true)} disabled={busy} />{i18n._({ id: "Isolate the voice (remove music and other sounds)", message: "Isolate the voice (remove music and other sounds)" })}</label>
      <label className="flex items-center gap-2 text-body"><Checkbox checked={reduceNoise} onCheckedChange={(value) => setReduceNoise(value === true)} disabled={busy} />{i18n._({ id: "Remove background noise", message: "Remove background noise" })}</label>
      <label className="flex items-center gap-2 text-body"><Checkbox checked={reduceEcho} onCheckedChange={(value) => setReduceEcho(value === true)} disabled={busy} />{i18n._({ id: "Reduce echo and room sound", message: "Reduce echo and room sound" })}</label>
      <p className={HELP}>{i18n._({ id: "Cleans every recording above before the voice is made. When you edit a voice and add no new recording, it cleans the one it has. Echo reduction is a light fix; a recording made in a quiet, soft room still works best.", message: "Cleans every recording above before the voice is made. Echo reduction is a light fix; a recording made in a quiet, soft room still works best." })}</p>
    </div> : null}
    {inspired ? <div className={FIELD}>
      <span className="text-body">{i18n._({ id: "How different from the original", message: "How different from the original" })}</span>
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
    {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
    {busy ? <div className="flex items-center gap-3"><Progress mode="spinner" label={i18n._({ id: "Making the voice", message: "Making the voice" })} /><p className={HELP}>{i18n._({ id: "Making the voice. This can take up to a minute the first time.", message: "Making the voice. This can take up to a minute the first time." })}</p></div> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
      <Button type="submit" disabled={!name.trim() || (!clip && !edit) || busy}>{edit ? i18n._({ id: "Save changes", message: "Save changes" }) : inspired ? i18n._({ id: "Make Inspired voice", message: "Make Inspired voice" }) : i18n._({ id: "Make voice", message: "Make voice" })}</Button>
    </div>
  </form>;
}
