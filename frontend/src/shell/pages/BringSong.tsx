// Bring a song to split into stems (the Studio's Stems page). Changing a brought song's style, removing its vocals or singing it in
// another household voice are now chips of the Song mode of the one Music composer (MusicComposer.tsx), not a form here.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dropzone } from "@maipai/ui/src/ui/dropzone";
import { Button } from "@maipai/ui/src/ui/button";
import { request } from "@/lib/api";
import { musicApi } from "@/lib/musicApi";
import { stemsAddress } from "./musicAddresses";

export const BRING_SONG_LINE = () => i18n._({ id: "Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac.", message: "Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac." });
const ERROR_LINE = () => i18n._({ id: "Something went wrong. Try again.", message: "Something went wrong. Try again." });

export function BringSong() {
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState("");
  const navigate = useNavigate();
  const add = async (picked: File) => {
    setProblem("");
    if (!/\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(picked.name) || picked.size > 40 * 1024 * 1024) { setProblem(BRING_SONG_LINE()); return; }
    setUploading(true);
    try { const form = new FormData(); form.append("file", picked, picked.name); const result = await request<{ id: string; name: string }>("/api/library/upload", { method: "POST", body: form }); setFile({ id: result.id, name: result.name }); }
    catch (error) { console.error(error); setProblem(ERROR_LINE()); }
    finally { setUploading(false); }
  };
  const split = async () => {
    if (!file) return;
    setProblem(""); setBusy(true);
    try { const card = await musicApi.editFromFile({ file_id: file.id, change: "stems" }); navigate(stemsAddress(card.id)); }
    catch (error) { console.error(error); setProblem(ERROR_LINE()); }
    finally { setBusy(false); }
  };
  return <section aria-label={i18n._({ id: "Bring a song", message: "Bring a song" })} data-testid="bring-song" className="flex flex-col gap-2">
    <p className="text-sm font-medium">{i18n._({ id: "Bring a song", message: "Bring a song" })}</p>
    <Dropzone label={uploading ? i18n._({ id: "Adding your song…", message: "Adding your song…" }) : file ? file.name : i18n._({ id: "Choose an audio file or drop it here", message: "Choose an audio file or drop it here" })} accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" disabled={uploading || busy} onFile={(picked) => { void add(picked); }} />
    {file && !uploading ? <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => { void split(); }}>{i18n._({ id: "Split into stems", message: "Split into stems" })}</Button></div> : null}
    {problem ? <p role="status">{problem}</p> : null}
  </section>;
}
