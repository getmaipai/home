import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { i18n } from "@lingui/core";
import { api, type Roster } from "@/lib/api";
import { videosApi } from "@/lib/videosApi";

type Seed = { trackId?: string; clipId?: string };
export function useCutToBeatDialog({ open, onOpenChange, me, seed }: { open: boolean; onOpenChange: (open: boolean) => void; me: Roster; seed: Seed }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string[]>([]);
  const [track, setTrack] = useState("");
  const [beats, setBeats] = useState("4");
  const [length, setLength] = useState("30");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    setPicked(seed.clipId ? [seed.clipId] : []);
    setTrack(seed.trackId ?? "");
  }, [seed.trackId, seed.clipId, open]);
  const videos = useQuery({ queryKey: ["studio-picker", "video", me.id], enabled: open, queryFn: async () => (await api.library({ type: "video", owner: "me", sort: "newest", limit: 60 })).items.filter((item) => item.owner.id === me.id && item.origin === "made" && item.chat_id !== null) });
  const songs = useQuery({ queryKey: ["studio-picker", "audio", me.id], enabled: open, queryFn: async () => (await api.library({ type: "audio", owner: "me", sort: "newest", limit: 60 })).items.filter((item) => item.owner.id === me.id) });
  const clips = videos.data ?? [];
  const tracks = songs.data ?? [];
  const toggle = (id: string, checked: boolean) => setPicked((old) => checked ? (old.length < 6 && !old.includes(id) ? [...old, id] : old) : old.filter((entry) => entry !== id));
  async function submit() {
    if (!track || picked.length === 0) return;
    setBusy(true);
    setProblem("");
    try {
      const card = await videosApi.cutToBeat({ clips: picked, track, beats_per_cut: Number(beats) as 1 | 2 | 4 | 8, length_s: Number(length) as 15 | 30 | 60 });
      if (card.conversation_id) { onOpenChange(false); navigate(`/chat?conversation=${encodeURIComponent(card.conversation_id)}`); }
    } catch (error) { console.error(error); setProblem(i18n._({ id: "The cut could not be made. Try again in a minute.", message: "The cut could not be made. Try again in a minute." })); }
    finally { setBusy(false); }
  }
  return { clips, tracks, problem, picked, track, setTrack, beats, setBeats, length, setLength, busy, toggle, submit, seededSong: Boolean(seed.trackId) };
}
