import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Player } from "@maipai/ui/src/primitives/Player";
import { useVoiceAvailable } from "@/apps/chat/useChatAvailability";
import { requestJson } from "@/lib/api";

type VoiceOption = { id: string; label: string; kind: "preset" | "clip"; engine: "fish-audio-drama-3" | "chatterbox-turbo"; tags: string[] };
type VoiceOptions = { voices: VoiceOption[] };
type VoiceoverResult = { file_id: string; seconds: number; engine: VoiceOption["engine"]; voice: string; kind: VoiceOption["kind"] };
type MadeVoiceover = VoiceoverResult & { key: number };

const ENGINE_LABEL: Record<VoiceOption["engine"], string> = {
  "fish-audio-drama-3": "the recorded voice engine",
  "chatterbox-turbo": "the standard voice engine",
};
const VOICE_UNAVAILABLE_LINE = "Home can't speak right now. Try again in a minute.";

export function VoiceCreate() {
  const options = useQuery({ queryKey: ["voiceover-options"], queryFn: () => requestJson<VoiceOptions>("/api/voiceover/options"), staleTime: 30_000 });
  const voiceAvailable = useVoiceAvailable();
  const [voice, setVoice] = useState("");
  const [script, setScript] = useState("");
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState("");
  const [results, setResults] = useState<MadeVoiceover[]>([]);
  const voices = options.data?.voices ?? [];
  const selectedVoice = voices.find((item) => item.id === voice) ?? voices[0];
  const selectedId = selectedVoice?.id ?? "";
  const scriptEmpty = !script.trim();
  const reason = scriptEmpty ? "Write something to speak." : making ? "Making your voiceover…" : !voiceAvailable ? VOICE_UNAVAILABLE_LINE : "";

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
      setResults((current) => [{ ...result, key: Date.now() }, ...current]);
    } catch (error) {
      setProblem(error instanceof Error && error.message ? error.message : "Home could not make that voiceover. Try again.");
    } finally {
      setMaking(false);
    }
  };

  return <div className="flex flex-col gap-3" data-testid="music-voice-create">
    <h2 className="text-lg font-semibold">Make a voiceover</h2>
    <div className="flex flex-col gap-1">
      <label htmlFor="voiceover-voice">Voice</label>
      <Select value={selectedId} onValueChange={(value) => setVoice(value ?? "")}>
        <SelectTrigger id="voiceover-voice" aria-label="Voice"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
        <SelectContent>{voices.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1">
      <label htmlFor="voiceover-script">Script</label>
      <Textarea id="voiceover-script" aria-label="Script" rows={5} maxLength={2000} value={script} onChange={(event) => setScript(event.currentTarget.value)} />
    </div>
    {selectedVoice?.tags.length ? <div className="flex flex-wrap gap-2" role="group" aria-label="Voice tags">
      {selectedVoice.tags.map((tag) => <Chip key={tag} onClick={() => setScript((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}[${tag}]`)}>[{tag}]</Chip>)}
    </div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={scriptEmpty || making || !voiceAvailable || !selectedId} onClick={() => { void make(); }}>Make voiceover</Button>
      {reason ? <p className="text-muted-foreground text-sm">{reason}</p> : null}
    </div>
    {problem ? <p role="alert">{problem}</p> : null}
    {results.map((result) => <article key={result.key} className="flex flex-col gap-2">
      <Player src={`/api/files/${encodeURIComponent(result.file_id)}/content`} kind="audio" layout="audio" title="Voiceover" />
      <p>Spoken by {ENGINE_LABEL[result.engine]}</p>
      <Link to={`/files?file=${encodeURIComponent(result.file_id)}`}>Open in Library</Link>
    </article>)}
  </div>;
}
