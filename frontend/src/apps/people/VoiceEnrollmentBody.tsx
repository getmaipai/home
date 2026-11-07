import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/ui/card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { requestJson, type Roster } from "@/lib/api";
import { canEnrollFace } from "@/apps/people/faceEnrollmentGate";
import { audioBlobToWav16k } from "@/apps/people/voiceEnrollment";

interface VoicePrint { id: string; created_at: string }

export function VoiceEnrollmentBody({ viewer, profile }: { viewer: Roster; profile: Roster }) {
  const allowed = canEnrollFace(viewer, { id: profile.id, role: profile.role });
  const queryClient = useQueryClient();
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const query = useQuery<VoicePrint[]>({
    queryKey: ["voice-prints", profile.id],
    queryFn: () => requestJson<VoicePrint[]>(`/api/voice-prints?person_id=${encodeURIComponent(profile.id)}`),
    enabled: allowed,
  });
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  async function startRecording() {
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setBusy(true);
        try {
          const wav = await audioBlobToWav16k(new Blob(chunksRef.current, { type: recorder.mimeType }));
          const form = new FormData(); form.set("person_id", profile.id); form.set("audio", wav, "voice-sample.wav");
          await requestJson("/api/voice-prints/enroll", { method: "POST", body: form });
          await queryClient.invalidateQueries({ queryKey: ["voice-prints", profile.id] });
          setMessage(i18n._({ id: "Voice sample saved.", message: "Voice sample saved." }));
        } catch (error) { setMessage(error instanceof Error ? error.message : i18n._({ id: "Could not save this sample.", message: "Could not save this sample." })); }
        finally { setBusy(false); }
      };
      recorder.start(); setRecording(true);
    } catch { setMessage(i18n._({ id: "Microphone access is unavailable. Check your browser permission and try again.", message: "Microphone access is unavailable. Check your browser permission and try again." })); }
  }

  function stopRecording() { recorderRef.current?.stop(); setRecording(false); }
  async function deletePrint(id?: string) {
    setBusy(true); setMessage("");
    try {
      const url = id ? `/api/voice-prints/${encodeURIComponent(id)}` : `/api/voice-prints?person_id=${encodeURIComponent(profile.id)}`;
      await requestJson(url, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["voice-prints", profile.id] });
      setMessage(id ? i18n._({ id: "Voice sample deleted.", message: "Voice sample deleted." }) : i18n._({ id: "All voice samples deleted.", message: "All voice samples deleted." }));
    } catch (error) { setMessage(error instanceof Error ? error.message : i18n._({ id: "Could not delete the voice sample.", message: "Could not delete the voice sample." })); }
    finally { setBusy(false); }
  }

  if (!allowed) return null;
  return <>
    <CardHeader><CardTitle>{i18n._({ id: "Voice recognition", message: "Voice recognition" })}</CardTitle><CardDescription>{i18n._({ id: "MaiPai can use numbers derived from your voice to recognize you. Your recordings are not kept.", message: "MaiPai can use numbers derived from your voice to recognize you. Your recordings are not kept." })}</CardDescription></CardHeader>
    <CardContent>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{i18n._({ id: "Record a few short samples. Say a number or read a sentence in your usual voice. Recording is used to make the voice print, then discarded. The server checks that the person being enrolled can consent. A child cannot consent for themself. A teen must consent for themself. Guests cannot enroll.", message: "Record a few short samples. Say a number or read a sentence in your usual voice. Recording is used to make the voice print, then discarded. The server checks that the person being enrolled can consent. A child cannot consent for themself. A teen must consent for themself. Guests cannot enroll." })}</p>
        <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={i18n._({ id: "Could not load voice samples.", message: "Could not load voice samples." })} loadingLabel={i18n._({ id: "Loading voice samples", message: "Loading voice samples" })}>
          {(prints) => <>
            <p aria-live="polite" className="text-sm">{i18n._({ id: "{count, plural, one {# voice sample saved} other {# voice samples saved}}", message: "{count, plural, one {# voice sample saved} other {# voice samples saved}}", values: { count: prints.length } })}</p>
            {prints.map((print, index) => <div key={print.id} className="flex items-center justify-between gap-3"><span className="text-sm">{i18n._({ id: "Sample {number}", message: "Sample {number}", values: { number: index + 1 } })}</span><Button type="button" variant="ghost" disabled={busy || recording} onClick={() => void deletePrint(print.id)}>{i18n._({ id: "Delete", message: "Delete" })}</Button></div>)}
            {prints.length ? <Button type="button" variant="outline" disabled={busy || recording} onClick={() => void deletePrint()}>{i18n._({ id: "Delete all samples", message: "Delete all samples" })}</Button> : null}
          </>}
        </AsyncState>
        {recording ? <Button type="button" variant="destructive" onClick={stopRecording}>{i18n._({ id: "Stop recording", message: "Stop recording" })}</Button> : <Button type="button" variant="outline" disabled={busy} onClick={() => void startRecording()}>{busy ? i18n._({ id: "Saving sample…", message: "Saving sample…" }) : i18n._({ id: "Record a sample", message: "Record a sample" })}</Button>}
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
    </CardContent>
  </>;
}
