export type HeardSong = { title: string; artist?: string; album?: string; year?: number; source: "library" | "acoustid"; at: number };
const TTL = 15 * 60_000;
const heard = new Map<string, HeardSong>();
export function noteHeardSong(deviceId: string, song: HeardSong): void { heard.set(deviceId, { ...song }); }
export function heardSongFor(deviceId: string, now = Date.now()): HeardSong | null {
  const song = heard.get(deviceId);
  if (!song) return null;
  if (now - song.at >= TTL || now < song.at) { heard.delete(deviceId); return null; }
  return { ...song };
}
export function clearHeardSong(deviceId: string): void { heard.delete(deviceId); }
export function __resetHeardSongsForTests(): void { heard.clear(); }
export function heardSongContextLine(song: HeardSong, now = Date.now()): string {
  const clean = (value: string | undefined) => value?.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>\[\]{}|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  const title = clean(song.title) || "Unknown title";
  const artist = clean(song.artist);
  const album = clean(song.album);
  const ageMinutes = Math.max(0, Math.floor((now - song.at) / 60_000));
  const detail = [album, song.year].filter((part) => part !== undefined && part !== "").join(", ");
  const source = song.source === "library" ? "your library" : "AcoustID";
  return `Heard on this robot ${ageMinutes} min ago: ${title}${artist ? ` by ${artist}` : ""}${detail ? ` (${detail})` : ""}, named from ${source}. If asked about it, answer from what you know; do not claim to hear it now.`;
}
