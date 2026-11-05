import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Dropzone } from "@maipai/ui/src/ui/dropzone";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { request } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { householdVoicesApi } from "@/lib/householdVoicesApi";
import { songAddress, stemsAddress } from "./MusicWorkspacePage";

export const BRING_SONG_LINE = "Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac.";
const ERROR_LINE = "Something went wrong. Try again.";

export function BringSong({ mode = "edit", adult = false }: { mode?: "edit" | "stems"; adult?: boolean }) {
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [style, setStyle] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState("");
  const [voice, setVoice] = useState("");
  const voices = useQuery({ queryKey: ["household-voices"], queryFn: () => householdVoicesApi.list(), enabled: adult && mode === "edit", staleTime: 30_000 });
  const navigate = useNavigate();
  const add = async (picked: File) => {
    setProblem("");
    if (!/\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(picked.name) || picked.size > 40 * 1024 * 1024) { setProblem(BRING_SONG_LINE); return; }
    setUploading(true);
    try { const form = new FormData(); form.append("file", picked, picked.name); const result = await request<{ id: string; name: string }>("/api/library/upload", { method: "POST", body: form }); setFile({ id: result.id, name: result.name }); }
    catch (error) { setProblem(error instanceof Error && error.message ? error.message : ERROR_LINE); }
    finally { setUploading(false); }
  };
  const start = async (change: "restyle" | "parts" | "stems" | "voice_swap") => {
    if (!file) return;
    setProblem(""); setBusy(true);
    try {
      const card: MusicCard = await musicApi.editFromFile({ file_id: file.id, change, ...(change === "voice_swap" ? { voice } : {}), ...(change === "restyle" ? { style: style.trim() } : {}), ...(change === "parts" ? { parts: { drop: ["vocals"] } } : {}) });
      navigate(change === "stems" ? stemsAddress(card.id) : songAddress(card.id));
    } catch (error) { setProblem(error instanceof Error && error.message ? error.message : ERROR_LINE); }
    finally { setBusy(false); }
  };
  return <section aria-label="Bring a song" data-testid="bring-song" className="flex flex-col gap-2">
    <p className="text-sm font-medium">Bring a song</p>
    <Dropzone label={uploading ? "Adding your song…" : file ? file.name : "Choose an audio file or drop it here"} accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" disabled={uploading || busy} onFile={(picked) => { void add(picked); }} />
    {file && !uploading ? <div className="flex flex-col gap-2">
      {mode === "edit" ? <div className="flex flex-col gap-1"><label htmlFor="bring-song-style">How should it sound?</label><Input id="bring-song-style" value={style} maxLength={600} onChange={(event) => setStyle(event.currentTarget.value)} /></div> : null}
      <div className="flex flex-wrap gap-2">
        {mode === "edit" ? <Button type="button" disabled={busy || style.trim().length < 3} onClick={() => { void start("restyle"); }}>Change the style</Button> : null}
        {mode === "edit" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { void start("parts"); }}>Remove the vocals</Button> : null}
        <Button type="button" variant={mode === "edit" ? "secondary" : "default"} disabled={busy} onClick={() => { void start("stems"); }}>Split into stems</Button>
        {adult && mode === "edit" ? <>
          <Select value={voice} onValueChange={(value) => setVoice(value ?? "")}>
            <SelectTrigger aria-label="Household voice"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
            <SelectContent>{(voices.data?.voices ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="secondary" disabled={busy || !voice} onClick={() => { void start("voice_swap"); }}>Sing it in another voice</Button>
        </> : null}
      </div>
    </div> : null}
    {problem ? <p role="status">{problem}</p> : null}
  </section>;
}
