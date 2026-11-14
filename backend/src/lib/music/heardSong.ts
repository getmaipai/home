import type { IdentifyCandidate } from "./identify";

export type HeardCandidate = IdentifyCandidate & { rejected?: boolean; settled?: boolean; suggestedBy?: HeardSong["source"][] };
export type HeardSong = { title: string; artist?: string; album?: string; year?: number; source: "library" | "shazam" | "acoustid" | "home"; score?: number; at: number; agrees?: boolean; rejected?: boolean; settled?: boolean; candidates?: HeardCandidate[]; nowPlaying?: boolean };
const TTL = 15 * 60_000;
const heard = new Map<string, HeardSong>();
const sourceOrder: Record<HeardSong["source"], number> = { library: 0, shazam: 1, acoustid: 2, home: 3 };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\bfeat\.?\b.*$/g, " ").replace(/[^a-z0-9]/g, "").trim();
const songKey = (s: { title: string; artist?: string }) => `${normalize(s.title)}|${normalize(s.artist ?? "")}`;

export function noteHeardSong(deviceId: string, song: HeardSong): void {
  const current = live(deviceId);
  if (current?.source === "home" && current.nowPlaying) { addHeardCandidates(deviceId, [{ title: song.title, artist: song.artist ?? "", album: song.album ?? null, year: song.year ?? null, source: song.source === "home" ? "library" : song.source, score: song.score ?? 0, agrees: songKey(current) === songKey(song) }]); return; }
  heard.set(deviceId, { ...song, candidates: [] });
}
export function noteNowPlaying(deviceId: string, song: Omit<HeardSong, "source" | "at" | "nowPlaying">, now = Date.now()): void {
  const previous = live(deviceId, now);
  const candidates = previous?.source === "home" ? previous.candidates ?? [] : [];
  heard.set(deviceId, { ...song, source: "home", at: now, nowPlaying: true, candidates: [...candidates] });
}
export function clearNowPlaying(deviceId: string): void { const current = live(deviceId); if (current?.source === "home") current.nowPlaying = false; }
function live(deviceId: string, now = Date.now()): HeardSong | null {
  const song = heard.get(deviceId); if (!song) return null;
  if (now - song.at >= TTL || now < song.at) { heard.delete(deviceId); return null; } return song;
}
export function heardSongFor(deviceId: string, now = Date.now()): HeardSong | null { const song = live(deviceId, now); return song ? { ...song, candidates: [...(song.candidates ?? [])] } : null; }
export function addHeardCandidates(deviceId: string, candidates: IdentifyCandidate[], now = Date.now()): void {
  const song = live(deviceId, now); if (!song) return;
  for (const candidate of candidates) {
    const index = (song.candidates ?? []).findIndex((old) => songKey(old) === songKey(candidate));
    if (index >= 0) {
      const old = song.candidates![index]!;
      old.suggestedBy ??= [old.source];
      if (!old.suggestedBy.includes(candidate.source)) old.suggestedBy.push(candidate.source);
      if (!old.settled && !old.rejected && candidate.score > old.score) song.candidates![index] = { ...candidate, suggestedBy: old.suggestedBy };
    } else (song.candidates ??= []).push({ ...candidate, suggestedBy: [candidate.source] });
  }
  if (!song.candidates?.some((c) => songKey(c) === songKey(song))) song.candidates?.unshift({ title: song.title, artist: song.artist ?? "", album: song.album ?? null, year: song.year ?? null, source: song.source, score: song.score ?? 0, agrees: true, suggestedBy: [song.source] });
}
export function rejectHeardSong(deviceId: string, now = Date.now()): HeardSong | null {
  const song = live(deviceId, now); if (!song) return null; song.rejected = true;
  const oldKey = songKey(song);
  const currentCandidate = song.candidates?.find((c) => songKey(c) === oldKey); if (currentCandidate) currentCandidate.rejected = true;
  const next = (song.candidates ?? []).filter((c) => !c.rejected && songKey(c) !== oldKey).sort((a, b) => b.score - a.score || sourceOrder[a.source] - sourceOrder[b.source])[0];
  if (!next) return null;
  song.title = next.title; song.artist = next.artist; song.album = next.album ?? undefined; song.year = next.year ?? undefined; song.source = next.source; song.score = next.score; song.agrees = next.agrees; song.rejected = false; song.settled = false;
  return { ...song, candidates: [...(song.candidates ?? [])] };
}
export function confirmHeardSong(deviceId: string, title?: string, now = Date.now()): HeardSong | null {
  const song = live(deviceId, now); if (!song) return null;
  const candidate = title ? (song.candidates ?? []).find((c) => normalize(c.title) === normalize(title)) : undefined;
  if (candidate) { song.title = candidate.title; song.artist = candidate.artist; song.album = candidate.album ?? undefined; song.year = candidate.year ?? undefined; song.source = candidate.source; song.score = candidate.score; song.agrees = candidate.agrees; }
  song.settled = true; return { ...song, candidates: [...(song.candidates ?? [])] };
}
export function findHeardCandidate(deviceId: string, query: string, now = Date.now()): { candidate: IdentifyCandidate; alsoSuggested: boolean } | null {
  const song = live(deviceId, now); if (!song) return null; const q = normalize(query); if (!q) return null;
  const candidate = (song.candidates ?? []).filter((c) => normalize(c.title).includes(q) || q.includes(normalize(c.title))).sort((a, b) => (b.suggestedBy?.length ?? 0) - (a.suggestedBy?.length ?? 0))[0];
  return candidate ? { candidate: { ...candidate }, alsoSuggested: (candidate.suggestedBy?.length ?? 0) > 1 } : null;
}
export function clearHeardSong(deviceId: string): void { heard.delete(deviceId); }
export function __resetHeardSongsForTests(): void { heard.clear(); }
export function heardSongContextLine(song: HeardSong, now = Date.now()): string {
  const clean = (value: string | undefined) => value?.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>\[\]{}|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  const title = clean(song.title) || "Unknown title"; const artist = clean(song.artist); const album = clean(song.album);
  const ageMinutes = Math.max(0, Math.floor((now - song.at) / 60_000)); const detail = [album, song.year].filter((part) => part !== undefined && part !== "").join(", ");
  const source = song.source === "library" ? "your library" : song.source === "shazam" ? "Shazam" : song.source === "acoustid" ? "AcoustID" : "Home";
  const disagree = (song.candidates ?? []).find((c) => !c.agrees && !c.rejected);
  const rejectedTitle = (song.candidates ?? []).find((c) => c.rejected)?.title;
  const homeLine = song.source === "home" ? `Home ${song.nowPlaying ? "is playing" : "was playing"} ${title}${artist ? ` by ${artist}` : ""}${detail ? ` (${detail})` : ""}${song.nowPlaying ? " on this robot's person's player. You already know this song; answer from this line and do not call song_name listen." : ` ${ageMinutes} min ago.`}` : null;
  return [homeLine ?? `Heard on this robot ${ageMinutes} min ago: ${title}${artist ? ` by ${artist}` : ""}${detail ? ` (${detail})` : ""}, named from ${source}.`, disagree ? `The other service heard it as ${clean(disagree.title)} by ${clean(disagree.artist)}.` : "", (song.rejected || rejectedTitle) ? `The person said it is not ${clean(rejectedTitle) || title}.` : "", song.settled ? "The person confirmed it." : "", "If wrong, another song is named, or it is right, use song_name action reject, suggest, or confirm.", "Do not claim to hear it now."].filter(Boolean).join(" ").slice(0, 650);
}
