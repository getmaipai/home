// MEDIA-VIDEOS-01: hands the kit Player's media element to the shell's audio session (AUDIO-SESSION-01) for as long as a media app's
// play page shows it, so one thing plays at a time across media and chat voice, the person's video speed applies, the sleep timer
// reaches it and the Media Session shows its title. The Player is drawn by the page document; this only finds its element by the
// kit's own `data-slot="player-media"` and registers it. It draws nothing.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAudioRegistration } from "@/shell/audioSessionContext";
import type { AudioChapter, AudioItem } from "@/shell/audioSession";

interface PlayedItem {
  id: string;
  title: string;
  channel: string | null;
  poster: string | null;
  duration_s: number | null;
  chapters: Array<{ start_s: number; title: string }>;
}

/** The item's chapters with an end each (the next one's start, the last one's the length), for the sleep timer's "end of chapter". */
export function chaptersWithEnds(chapters: PlayedItem["chapters"], durationS: number | null): AudioChapter[] {
  const sorted = [...chapters].sort((a, b) => a.start_s - b.start_s);
  return sorted.map((chapter, index) => ({ start_s: chapter.start_s, end_s: sorted[index + 1]?.start_s ?? durationS ?? chapter.start_s, title: chapter.title }));
}

export function MediaPlayerRegistration({ appId, mediaId, container }: { appId: string; mediaId: string | null; container: HTMLElement | null }) {
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const item = useQuery({
    queryKey: ["media-registration", appId, mediaId],
    queryFn: async () => {
      const found = await api.appData<PlayedItem | PlayedItem[]>(appId, "item", { id: mediaId });
      return Array.isArray(found) ? (found[0] ?? null) : found;
    },
    enabled: mediaId !== null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!container) return;
    const find = () => setElement((container.querySelector('[data-slot="player-media"]') as HTMLMediaElement | null) ?? null);
    find();
    const observer = new MutationObserver(find);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container, mediaId]);

  const played = item.data ?? null;
  const audioItem = useMemo<AudioItem>(
    () => ({
      title: played?.title ?? "Video",
      ...(played?.channel ? { artist: played.channel } : {}),
      ...(played?.poster ? { artworkUrl: played.poster } : {}),
      ...(played ? { chapters: chaptersWithEnds(played.chapters ?? [], played.duration_s) } : {}),
    }),
    [played],
  );
  useAudioRegistration(played ? element : null, { kind: "video", item: audioItem });
  return null;
}
