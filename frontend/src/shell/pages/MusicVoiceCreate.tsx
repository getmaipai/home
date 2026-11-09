import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Player } from "@maipai/ui/src/primitives/Player";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { Dropzone } from "@maipai/ui/src/ui/dropzone";
import { useVoiceAvailable } from "@/apps/chat/useChatAvailability";
import { request, requestJson } from "@/lib/api";

type VoiceOption = { id: string; label: string; kind: "preset" | "clip"; engine: "fish-audio-drama-3" | "chatterbox-turbo"; tags: string[] };
type VoiceOptions = { voices: VoiceOption[] };
type VoiceoverResult = { file_id: string; seconds: number; engine: VoiceOption["engine"]; voice: string; kind: VoiceOption["kind"] };
type MadeVoiceover = VoiceoverResult & { key: number };
type ChangeResult = { file_id: string; kind_of_source: "audio" | "video"; seconds: number; spoken_seconds: number; source_seconds: number | null; difference_seconds: number | null; engine: VoiceOption["engine"]; voice: string; kind: VoiceOption["kind"] };
type MadeResult = { operation: "voiceover"; value: MadeVoiceover } | { operation: "change"; value: ChangeResult & { key: number } };

function VideoResult({ src }: { src: string }) {
  return <video src={src} controls><track kind="captions" srcLang="en" label={i18n._({ id: "Captions unavailable", message: "Captions unavailable" })} /></video>;
}

const ENGINE_LABEL: () => Record<VoiceOption["engine"], string> = () => ({
  "fish-audio-drama-3": i18n._({ id: "the recorded voice engine", message: "the recorded voice engine" }),
  "chatterbox-turbo": i18n._({ id: "the standard voice engine", message: "the standard voice engine" }),
});
const VOICE_UNAVAILABLE_LINE = () => i18n._({ id: "Home can't speak right now. Try again in a minute.", message: "Home can't speak right now. Try again in a minute." });

export function VoiceCreate() {
  const options = useQuery({ queryKey: ["voiceover-options"], queryFn: () => requestJson<VoiceOptions>("/api/voiceover/options"), staleTime: 30_000 });
  const voiceAvailable = useVoiceAvailable();
  const [voice, setVoice] = useState("");
  const [script, setScript] = useState("");
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState("");
  const [results, setResults] = useState<MadeResult[]>([]);
  const [mode, setMode] = useState<"voiceover" | "change">("voiceover");
  const [source, setSource] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [changeProblem, setChangeProblem] = useState("");
  const voices = options.data?.voices ?? [];
  const selectedVoice = voices.find((item) => item.id === voice) ?? voices[0];
  const selectedId = selectedVoice?.id ?? "";
  const scriptEmpty = !script.trim();
  const reason = scriptEmpty ? i18n._({ id: "Write something to speak.", message: "Write something to speak." }) : making ? i18n._({ id: "Making your voiceover…", message: "Making your voiceover…" }) : !voiceAvailable ? VOICE_UNAVAILABLE_LINE() : "";

  const make = async () => {
    if (!selectedId || scriptEmpty || making || !voiceAvailable) return;
    setMaking(true);
    setProblem("");
    try {
      const result = await requestJson<VoiceoverResult>("/api/voiceover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ script, voice: selectedId }),
      });
      setResults((current) => [{ operation: "voiceover", value: { ...result, key: Date.now() } }, ...current]);
    } catch (error) {
      console.error(error);
      setProblem(i18n._({ id: "Home could not make that voiceover. Try again.", message: "Home could not make that voiceover. Try again." }));
    } finally {
      setMaking(false);
    }
  };

  const addSource = async (picked: File) => {
    setChangeProblem("");
    setSource(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", picked, picked.name);
      const result = await request<{ id: string; name: string }>("/api/library/upload", { method: "POST", body: form });
      setSource({ id: result.id, name: result.name });
    } catch (error) {
      console.error(error);
      setChangeProblem(i18n._({ id: "Home could not add that file. Try again.", message: "Home could not add that file. Try again." }));
    } finally { setUploading(false); }
  };

  const changeVoice = async () => {
    if (!source || !selectedId || making || !voiceAvailable) return;
    setMaking(true); setChangeProblem("");
    try {
      const result = await requestJson<ChangeResult>("/api/voiceover/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: source.id, voice: selectedId }) });
      setResults((current) => [{ operation: "change", value: { ...result, key: Date.now() } }, ...current]);
    } catch (error) { console.error(error); setChangeProblem(i18n._({ id: "Home could not change that voice. Try again.", message: "Home could not change that voice. Try again." })); }
    finally { setMaking(false); }
  };

  const changeReason = !source ? i18n._({ id: "Choose a file first.", message: "Choose a file first." }) : !selectedId ? i18n._({ id: "Choose a voice.", message: "Choose a voice." }) : making ? i18n._({ id: "Changing the voice…", message: "Changing the voice…" }) : !voiceAvailable ? VOICE_UNAVAILABLE_LINE() : "";
  const differenceLine = (difference: number | null, sourceKind: "audio" | "video") => {
    if (difference === null || Math.abs(difference) < 0.5) return null;
    const amount = Math.abs(difference) < 0.75 ? "0.5" : String(Math.round(Math.abs(difference)));
    return difference > 0 ? i18n._({ id: "{sourceKind, select, video {The new voice is {amount} seconds longer than the video, so the end was cut.} other {The new voice is {amount} seconds longer than the audio, so the end was cut.}}", message: "{sourceKind, select, video {The new voice is {amount} seconds longer than the video, so the end was cut.} other {The new voice is {amount} seconds longer than the audio, so the end was cut.}}", values: { amount, sourceKind } }) : i18n._({ id: "The new voice is {amount} seconds shorter, so the end is quiet.", message: "The new voice is {amount} seconds shorter, so the end is quiet.", values: { amount } });
  };
  const resultRows = results.map((entry) => entry.operation === "voiceover"
    ? <article key={`voiceover-${entry.value.key}`} className="flex flex-col gap-2">
      <Player src={`/api/files/${encodeURIComponent(entry.value.file_id)}/content`} kind="audio" layout="audio" title={i18n._({ id: "Voiceover", message: "Voiceover" })} />
      <p>{i18n._({ id: "Spoken by {engine}", message: "Spoken by {engine}", values: { engine: ENGINE_LABEL()[entry.value.engine] } })}</p>
      <Link to={`/files?file=${encodeURIComponent(entry.value.file_id)}`}>{i18n._({ id: "Open in Library", message: "Open in Library" })}</Link>
    </article>
    : <article key={`change-${entry.value.key}`} className="flex flex-col gap-2">
      {entry.value.kind_of_source === "video" ? <VideoResult src={`/api/files/${encodeURIComponent(entry.value.file_id)}/content`} /> : <Player src={`/api/files/${encodeURIComponent(entry.value.file_id)}/content`} kind="audio" layout="audio" title={i18n._({ id: "Changed voice", message: "Changed voice" })} />}
      <p>{i18n._({ id: "Spoken by {engine}", message: "Spoken by {engine}", values: { engine: ENGINE_LABEL()[entry.value.engine] } })}</p>
      {differenceLine(entry.value.difference_seconds, entry.value.kind_of_source) ? <p>{differenceLine(entry.value.difference_seconds, entry.value.kind_of_source)}</p> : null}
      <Link to={`/files?file=${encodeURIComponent(entry.value.file_id)}`}>{i18n._({ id: "Open in Library", message: "Open in Library" })}</Link>
    </article>);

  return <div className="flex flex-col gap-3" data-testid="music-voice-create">
    <ToggleGroup type="single" variant="segmented" fill value={mode} onValueChange={(next) => { if (next === "voiceover" || next === "change") setMode(next); }} aria-label={i18n._({ id: "Voice mode", message: "Voice mode" })}>
      <ToggleGroupItem value="voiceover">{i18n._({ id: "Voiceover", message: "Voiceover" })}</ToggleGroupItem><ToggleGroupItem value="change">{i18n._({ id: "Change voice", message: "Change voice" })}</ToggleGroupItem>
    </ToggleGroup>
    {mode === "voiceover" ? <>
    <h2 className="text-lg font-semibold">{i18n._({ id: "Make a voiceover", message: "Make a voiceover" })}</h2>
    <div className="flex flex-col gap-1">
      <label htmlFor="voiceover-voice">{i18n._({ id: "Voice", message: "Voice" })}</label>
      <Select value={selectedId} onValueChange={(value) => setVoice(value ?? "")}>
        <SelectTrigger id="voiceover-voice" aria-label={i18n._({ id: "Voice", message: "Voice" })}><SelectValue placeholder={i18n._({ id: "Choose a voice", message: "Choose a voice" })} /></SelectTrigger>
        <SelectContent>{voices.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1">
      <label htmlFor="voiceover-script">{i18n._({ id: "Script", message: "Script" })}</label>
      <Textarea id="voiceover-script" aria-label={i18n._({ id: "Script", message: "Script" })} rows={5} maxLength={2000} value={script} onChange={(event) => setScript(event.currentTarget.value)} />
    </div>
    {selectedVoice?.tags.length ? <div className="flex flex-wrap gap-2" role="group" aria-label={i18n._({ id: "Voice tags", message: "Voice tags" })}>
      {selectedVoice.tags.map((tag) => <Chip key={tag} onClick={() => setScript((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}[${tag}]`)}>[{tag}]</Chip>)}
    </div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={scriptEmpty || making || !voiceAvailable || !selectedId} onClick={() => { void make(); }}>{i18n._({ id: "Make voiceover", message: "Make voiceover" })}</Button>
      {reason ? <p className="text-muted-foreground text-sm">{reason}</p> : null}
    </div>
    {problem ? <p role="alert">{problem}</p> : null}
    </> : <>
      <Dropzone label={uploading ? i18n._({ id: "Adding your file…", message: "Adding your file…" }) : source ? source.name : i18n._({ id: "Choose an audio or video file or drop it here", message: "Choose an audio or video file or drop it here" })} accept="audio/*,video/*" disabled={uploading || making} onFile={(picked) => { void addSource(picked); }} />
      <div className="flex flex-col gap-1">
        <label htmlFor="change-voice-voice">{i18n._({ id: "Voice", message: "Voice" })}</label>
        <Select value={selectedId} onValueChange={(value) => setVoice(value ?? "")}>
          <SelectTrigger id="change-voice-voice" aria-label={i18n._({ id: "Voice", message: "Voice" })}><SelectValue placeholder={i18n._({ id: "Choose a voice", message: "Choose a voice" })} /></SelectTrigger>
          <SelectContent>{voices.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!source || !selectedId || making || !voiceAvailable} onClick={() => { void changeVoice(); }}>{i18n._({ id: "Change voice", message: "Change voice" })}</Button>
        {changeReason ? <p className="text-muted-foreground text-sm">{changeReason}</p> : null}
      </div>
      {changeProblem ? <p role="alert">{changeProblem}</p> : null}
      <p className="text-muted-foreground text-sm">{i18n._({ id: "The video's own sound is replaced. The original file is not changed.", message: "The video's own sound is replaced. The original file is not changed." })}</p>
    </>}
    {resultRows}
  </div>;
}
