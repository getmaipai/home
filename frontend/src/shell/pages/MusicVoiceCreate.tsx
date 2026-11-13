import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Player } from "@maipai/ui/src/primitives/Player";
import { useVoiceAvailable } from "@/apps/chat/useChatAvailability";
import { request, requestJson } from "@/lib/api";

export type VoiceOption = { id: string; label: string; kind: "preset" | "clip"; engine: "fish-audio-drama-3" | "chatterbox-turbo"; tags: string[] };
type VoiceOptions = { voices: VoiceOption[] };
type VoiceoverResult = { file_id: string; seconds: number; engine: VoiceOption["engine"]; voice: string; kind: VoiceOption["kind"] };
type MadeVoiceover = VoiceoverResult & { key: number };
type ChangeResult = { file_id: string; kind_of_source: "audio" | "video"; seconds: number; spoken_seconds: number; source_seconds: number | null; difference_seconds: number | null; engine: VoiceOption["engine"]; voice: string; kind: VoiceOption["kind"] };
export type MadeResult = { operation: "voiceover"; value: MadeVoiceover } | { operation: "change"; value: ChangeResult & { key: number } };

function VideoResult({ src }: { src: string }) {
  return <video src={src} controls><track kind="captions" srcLang="en" label={i18n._({ id: "Captions unavailable", message: "Captions unavailable" })} /></video>;
}

const ENGINE_LABEL: () => Record<VoiceOption["engine"], string> = () => ({
  "fish-audio-drama-3": i18n._({ id: "the recorded voice engine", message: "the recorded voice engine" }),
  "chatterbox-turbo": i18n._({ id: "the standard voice engine", message: "the standard voice engine" }),
});
export const VOICE_UNAVAILABLE_LINE = () => i18n._({ id: "Home can't speak right now. Try again in a minute.", message: "Home can't speak right now. Try again in a minute." });

// The Voiceover mode of the one Music composer (ONE-COMPOSER-01): this file holds the state and the requests of both voice
// operations (a spoken script, or a new voice on a file) and draws their results. The composer draws the panel; nothing here is a form.
export type VoiceOperation = "voiceover" | "change";
/** The tags the picked voice understands, in the voice's own order. */
export const tagsOf = (voices: readonly VoiceOption[], id: string): string[] => (voices.find((item) => item.id === id) ?? voices[0])?.tags ?? [];
/** A tag goes after the script with one space before it. */
export const withTag = (script: string, tag: string): string => `${script}${script && !script.endsWith(" ") ? " " : ""}[${tag}]`;

export function useVoiceMode(enabled: boolean) {
  const options = useQuery({ queryKey: ["voiceover-options"], queryFn: () => requestJson<VoiceOptions>("/api/voiceover/options"), staleTime: 30_000, enabled });
  const voiceAvailable = useVoiceAvailable();
  const [voice, setVoice] = useState("");
  const [script, setScript] = useState("");
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState("");
  const [results, setResults] = useState<MadeResult[]>([]);
  const [operation, setOperation] = useState<VoiceOperation>("voiceover");
  const [source, setSource] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const voices = options.data?.voices ?? [];
  const selectedId = (voices.find((item) => item.id === voice) ?? voices[0])?.id ?? "";
  const scriptEmpty = !script.trim();
  const blocker = operation === "voiceover"
    ? (scriptEmpty ? i18n._({ id: "Write something to speak.", message: "Write something to speak." }) : making ? i18n._({ id: "Making your voiceover…", message: "Making your voiceover…" }) : !voiceAvailable ? VOICE_UNAVAILABLE_LINE() : !selectedId ? i18n._({ id: "Choose a voice.", message: "Choose a voice." }) : "")
    : (!source ? i18n._({ id: "Choose a file first.", message: "Choose a file first." }) : !selectedId ? i18n._({ id: "Choose a voice.", message: "Choose a voice." }) : making ? i18n._({ id: "Changing the voice…", message: "Changing the voice…" }) : !voiceAvailable ? VOICE_UNAVAILABLE_LINE() : "");

  const make = async () => {
    if (blocker) return;
    setMaking(true); setProblem("");
    try {
      const result = await requestJson<VoiceoverResult>("/api/voiceover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ script, voice: selectedId }) });
      setResults((current) => [{ operation: "voiceover", value: { ...result, key: Date.now() } }, ...current]);
    } catch (error) { console.error(error); setProblem(i18n._({ id: "Home could not make that voiceover. Try again.", message: "Home could not make that voiceover. Try again." })); }
    finally { setMaking(false); }
  };
  const addSource = async (picked: File) => {
    setProblem(""); setSource(null); setUploading(true);
    try {
      const form = new FormData();
      form.append("file", picked, picked.name);
      const result = await request<{ id: string; name: string }>("/api/library/upload", { method: "POST", body: form });
      setSource({ id: result.id, name: result.name });
    } catch (error) { console.error(error); setProblem(i18n._({ id: "Home could not add that file. Try again.", message: "Home could not add that file. Try again." })); }
    finally { setUploading(false); }
  };
  const changeVoice = async () => {
    if (blocker || !source) return;
    setMaking(true); setProblem("");
    try {
      const result = await requestJson<ChangeResult>("/api/voiceover/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: source.id, voice: selectedId }) });
      setResults((current) => [{ operation: "change", value: { ...result, key: Date.now() } }, ...current]);
    } catch (error) { console.error(error); setProblem(i18n._({ id: "Home could not change that voice. Try again.", message: "Home could not change that voice. Try again." })); }
    finally { setMaking(false); }
  };
  return {
    voices, selectedId, script, setScript: (next: string) => setScript(next), setVoice: (next: string) => setVoice(next), operation, setOperation: (next: VoiceOperation) => { setOperation(next); setProblem(""); }, source, clearSource: () => setSource(null), addSource,
    uploading, making: making || uploading, problem, results, blocker, run: () => { void (operation === "voiceover" ? make() : changeVoice()); }, clear: () => setScript(""),
  };
}
export type VoiceMode = ReturnType<typeof useVoiceMode>;

/** The voiceovers and changed voices made so far, newest first, each with a player and a Library link. */
export function VoiceResults({ results }: { results: readonly MadeResult[] }) {
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

  return results.length ? <div className="flex flex-col gap-3" data-testid="music-voice-results">{resultRows}</div> : null;
}
