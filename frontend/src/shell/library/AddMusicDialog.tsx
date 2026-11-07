// AUDIO-PARITY-01 P2: "Add music" on a video in the Library viewer. One of the person's own songs, or new music made for the video
// (an instrumental the length of the clip), goes under the video as a new version through the one editor. The chat shows the result.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type Roster } from "@/lib/api";
import { videosApi } from "@/lib/videosApi";

export const NEW_MUSIC = "new";
export type MusicLevel = "quiet" | "soft" | "balanced" | "loud" | "very_loud";

export function useAddMusicDialog({ open, onOpenChange, me, clipId }: { open: boolean; onOpenChange: (open: boolean) => void; me: Roster; clipId: string }) {
  const navigate = useNavigate();
  const [choice, setChoice] = useState(NEW_MUSIC);
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<MusicLevel>("soft");
  const [busy, setBusy] = useState(false);
  const songs = useQuery({ queryKey: ["studio-picker", "audio", me.id], enabled: open, queryFn: async () => (await api.library({ type: "audio", owner: "me", sort: "newest", limit: 60 })).items.filter((item) => item.owner.id === me.id) });
  const ready = choice === NEW_MUSIC ? description.trim().length >= 3 : choice !== "";
  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const result = await videosApi.addMusic(choice === NEW_MUSIC ? { clip: clipId, make_music: description.trim(), level } : { clip: clipId, track: choice, level });
      onOpenChange(false);
      navigate(`/chat?conversation=${encodeURIComponent(result.conversation_id)}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "The music could not be added. Try again in a minute."); }
    finally { setBusy(false); }
  }
  return { songs: songs.data ?? [], choice, setChoice, description, setDescription, level, setLevel, busy, ready, submit };
}
