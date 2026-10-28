import type { PersonRow } from "@/types";
import { readableIn } from "./appHost";
import { liveSourceById } from "./access";
import type { MediaProgress } from "./model";
import { recentProgress } from "./progress";

export interface PodcastStats {
  year: number;
  total_seconds: number;
  episodes_finished: number;
  top_shows: Array<{ id: string; title: string; seconds: number }>;
  by_month: Array<{ month: string; seconds: number }>;
}

type StatsProgress = Pick<MediaProgress, "media_id" | "position" | "duration_s" | "completed" | "updated_at">;
type StatsEpisode = { id: string; title: string; show_title?: string; source_id: string | null; duration_s: number | null; artwork: unknown; external: unknown; added_at: string };

const stampMonth = (stamp: string): string => stamp.slice(0, 7);

/** Pure stats aggregation. Progress rows already belong to one person; the updated stamp attributes that row to a year/month. */
export function aggregatePodcastStats(progress: readonly StatsProgress[], episodes: readonly StatsEpisode[], year: number): PodcastStats {
  const episodeById = new Map(episodes.map((episode) => [episode.id, episode]));
  const months = new Map<string, number>();
  const shows = new Map<string, { title: string; seconds: number }>();
  let total = 0;
  let finished = 0;
  for (const row of progress) {
    const episode = episodeById.get(row.media_id);
    if (!episode) continue;
    const seconds = Math.max(0, Math.floor("seconds" in row.position ? row.position.seconds : row.duration_s === null ? 0 : row.duration_s * row.position.percent / 100));
    const month = stampMonth(row.updated_at);
    if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(0, 4)) !== year) continue;
    total += seconds;
    if (row.completed) finished += 1;
    months.set(month, (months.get(month) ?? 0) + seconds);
    const showId = episode.source_id ?? "unknown";
    const show = shows.get(showId) ?? { title: showId === "unknown" ? "Unknown show" : episode.show_title ?? episode.title, seconds: 0 };
    show.seconds += seconds;
    shows.set(showId, show);
  }
  return {
    year,
    total_seconds: total,
    episodes_finished: finished,
    top_shows: [...shows].map(([id, show]) => ({ id, title: show.title, seconds: show.seconds })).sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title)).slice(0, 5),
    by_month: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, seconds]) => ({ month, seconds })),
  };
}

/** Reads only the signed-in person's progress, and only episodes the same person can read in Podcasts. */
export function podcastStats(person: PersonRow, year: number): PodcastStats {
  const progress = recentProgress(person.id, 100000).filter((row) => row.updated_at.slice(0, 4) === String(year));
  const readable = progress.map((row) => readableIn(person, "podcasts", row.media_id)).filter((item): item is NonNullable<typeof item> => item !== null);
  const episodes = readable.map((item) => ({ id: item.id, title: item.title, show_title: liveSourceById(item.source_id ?? "")?.label, source_id: item.source_id, duration_s: item.duration_s, artwork: item.artwork, external: item.external, added_at: item.added_at }));
  const stats = aggregatePodcastStats(progress, episodes, year);
  return { ...stats, top_shows: stats.top_shows.map((show) => ({ ...show, title: liveSourceById(show.id)?.label ?? show.title })) };
}

/** Rows for the schema page: summary totals followed by each month and top show, with stable keys and user-facing labels. */
export function podcastStatsRows(person: PersonRow, year: number): Array<{ id: string; label: string; value: string }> {
  const stats = podcastStats(person, year);
  const hours = Math.floor(stats.total_seconds / 3600);
  const minutes = Math.floor((stats.total_seconds % 3600) / 60);
  const rows = [
    { id: "total", label: "Listening time", value: `${hours} hr ${minutes} min` },
    { id: "finished", label: "Episodes finished", value: String(stats.episodes_finished) },
    ...stats.top_shows.map((show, index) => ({ id: `show-${index}`, label: `Top show: ${show.title}`, value: `${Math.floor(show.seconds / 60)} min` })),
    ...stats.by_month.map((month) => ({ id: month.month, label: `${new Date(`${month.month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} listening`, value: `${Math.floor(month.seconds / 60)} min` })),
  ];
  return rows;
}

