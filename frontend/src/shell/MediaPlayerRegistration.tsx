// MEDIA-VIDEOS-01: hands a media app's playing element to the shell's audio session (AUDIO-SESSION-01), so one thing plays at a time
// across media and chat voice, the person's video speed applies, the sleep timer reaches it and the Media Session shows its title.
// MEDIA-POLISH-01: the element is the media host's own (mediaHost.tsx), registered for as long as the host holds the item, on the
// watch page, in the docked mini bar and while the person is in another app. It draws nothing.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAudioRegistration } from "@/shell/audioSessionContext";
import type { AudioChapter, AudioItem, AudioKind } from "@/shell/audioSession";

interface PlayedItem {
  id: string;
  title: string;
  channel: string | null;
  poster: string | null;
  duration_s: number | null;
  kind?: string;
  chapters: Array<{ start_s: number; title: string }>;
}

/** The item's chapters with an end each (the next one's start, the last one's the length), for the sleep timer's "end of chapter". */
export function chaptersWithEnds(chapters: PlayedItem["chapters"], durationS: number | null): AudioChapter[] {
  const sorted = [...chapters].sort((a, b) => a.start_s - b.start_s);
  return sorted.map((chapter, index) => ({ start_s: chapter.start_s, end_s: sorted[index + 1]?.start_s ?? durationS ?? chapter.start_s, title: chapter.title }));
}

/** The audio session's kind for what an app plays: it decides the person's speed (`audio.speed.<kind>`) and the sleep timer's reach. */
export function audioKindOfApp(appId: string): AudioKind {
  if (appId === "podcasts") return "podcast";
  if (appId === "music") return "music";
  if (appId === "books") return "audiobook";
  if (appId === "news") return "spoken_reply";
  return "video";
}

export function MediaPlayerRegistration({ appId, mediaId, element }: { appId: string; mediaId: string | null; element: HTMLMediaElement | null }) {
  const item = useQuery({
    queryKey: ["media-registration", appId, mediaId],
    queryFn: async () => {
      // A story being read aloud (News Listen) has no media item; the host's title is all the audio session needs.
      if (appId === "news") return { id: mediaId ?? "", title: "Story", channel: null, poster: null, duration_s: null, chapters: [] };
      const found = await api.appData<PlayedItem | PlayedItem[]>(appId, "item", { id: mediaId });
      return Array.isArray(found) ? (found[0] ?? null) : found;
    },
    enabled: mediaId !== null,
    staleTime: 60_000,
  });

  const played = item.data ?? null;
  const audioItem = useMemo<AudioItem>(
    () => ({
      title: played?.title ?? (appId === "podcasts" ? "Episode" : appId === "music" ? "Song" : "Video"),
      ...(played?.channel ? { artist: played.channel } : {}),
      ...(played?.poster ? { artworkUrl: played.poster } : {}),
      ...(played ? { chapters: chaptersWithEnds(played.chapters ?? [], played.duration_s) } : {}),
    }),
    [played, appId],
  );
  useAudioRegistration(played ? element : null, { kind: audioKindOfApp(appId), item: audioItem });
  useEffect(() => {
    if (appId !== "books" || !element || !mediaId || !played || played.kind !== "chapter") return;
    const report = (reason: string) => { if (Number.isFinite(element.currentTime)) void api.mediaProgress(appId, { media_id: mediaId, position_s: element.currentTime, duration_s: Number.isFinite(element.duration) ? element.duration : played.duration_s ?? 0, reason }, reason === "unload").catch(() => {}); };
    const pause = () => report("pause"); const seek = () => report("seek"); const ended = () => report("ended"); const unload = () => report("unload");
    element.addEventListener("pause", pause); element.addEventListener("seeked", seek); element.addEventListener("ended", ended); window.addEventListener("pagehide", unload);
    const timer = setInterval(() => { if (!element.paused && !element.ended) report("interval"); }, 10_000);
    return () => { unload(); clearInterval(timer); element.removeEventListener("pause", pause); element.removeEventListener("seeked", seek); element.removeEventListener("ended", ended); window.removeEventListener("pagehide", unload); };
  }, [appId, mediaId, element, played]);
  return null;
}
