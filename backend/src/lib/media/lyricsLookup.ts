export interface LyricsQuery { title: string; artist: string; album?: string | null; durationS?: number | null }
export interface TimedLine { t: number; line: string; section?: string | null }
export type LyricsOutcome =
  | { outcome: "hit"; text: string; timed?: TimedLine[] }
  | { outcome: "miss" }
  | { outcome: "refused" };

export function lrclibUrl(q: LyricsQuery): string {
  const params = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
  if (typeof q.album === "string" && q.album.length > 0) params.set("album_name", q.album);
  if (typeof q.durationS === "number" && q.durationS > 0) params.set("duration", String(Math.round(q.durationS)));
  return `https://lrclib.net/api/get?${params.toString()}`;
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,2}))?\]/g;

export function parseSyncedLyrics(synced: string): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const raw of synced.split(/\r?\n/)) {
    const stamps: Array<{ time: number; start: number; end: number }> = [];
    STAMP.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STAMP.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const frac = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
      stamps.push({ time: minutes * 60 + seconds + frac, start: match.index, end: match.index + match[0].length });
    }
    if (stamps.length === 0) continue;
    let text = raw;
    for (let i = stamps.length - 1; i >= 0; i--) {
      const stamp = stamps[i];
      if (!stamp) continue;
      text = text.slice(0, stamp.start) + text.slice(stamp.end);
    }
    for (const stamp of stamps) lines.push({ t: stamp.time, line: text.trim() });
  }
  return lines.sort((a, b) => a.t - b.t);
}

export async function lookupLyrics(
  q: LyricsQuery,
  deps?: { fetch?: typeof fetch; now?: () => number },
): Promise<LyricsOutcome> {
  const doFetch = deps?.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(lrclibUrl(q), {
      method: "GET",
      headers: { "User-Agent": "MaiPai-Home", Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { outcome: "refused" };
  }
  if (response.status === 404) return { outcome: "miss" };
  if (response.status !== 200) return { outcome: "refused" };
  let plain = "";
  let synced = "";
  try {
    const body = (await response.json()) as { plainLyrics?: unknown; syncedLyrics?: unknown };
    if (typeof body.plainLyrics === "string") plain = body.plainLyrics;
    if (typeof body.syncedLyrics === "string") synced = body.syncedLyrics;
  } catch {
    return { outcome: "refused" };
  }
  if (plain.trim() === "" && synced.trim() === "") return { outcome: "miss" };
  const timed = parseSyncedLyrics(synced);
  const text = plain.trim() !== "" ? plain.trim() : timed.map((line) => line.line).join("\n");
  const hit: LyricsOutcome = { outcome: "hit", text };
  if (timed.length > 0) hit.timed = timed;
  return hit;
}
