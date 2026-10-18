// Resolve named lyric tags against stored LRC, never infer a time from prose or ask another model.
function normal(text: string): string { return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
interface Section { name: string; lines: string[]; startLine: number; endLine: number }
function sectionsOf(lyrics: string): Section[] {
  const sections: Section[] = []; let line = 0;
  const counts = new Map<string, number>();
  for (const text of lyrics.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const tag = /^\[([^\]]+)\]$/.exec(text);
    if (tag) {
      if (sections.length) sections[sections.length - 1]!.endLine = line;
      const name = normal(tag[1]!); const count = (counts.get(name) ?? 0) + 1; counts.set(name, count);
      sections.push({ name: /\d$/.test(name) ? name : `${name} ${count}`, lines: [], startLine: line, endLine: line });
    } else { sections.at(-1)?.lines.push(text); line++; }
  }
  if (sections.length) sections[sections.length - 1]!.endLine = line;
  return sections;
}
export function resolveMusicSection(lyrics: string | undefined, lrc: string | null, section: string, duration: number): { from_s: number; to_s: number } | null {
  if (!lyrics || !lrc) return null;
  const sections = sectionsOf(lyrics); const wanted = normal(section);
  const target = sections.find((s) => s.name === wanted || s.name === `${wanted} 1`);
  if (!target?.lines.length) return null;
  const timings: Array<{ at: number; text: string }> = [];
  for (const line of lrc.split(/\r?\n/)) {
    const times = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = normal(line.replace(/\[[^\]]*\]/g, ""));
    if (text) for (const time of times) timings.push({ at: Number(time[1]) * 60 + Number(time[2]), text });
  }
  timings.sort((a, b) => a.at - b.at);
  // Sequential matching disambiguates a chorus repeated later in the same song.
  const matched = new Map<number, number>(); let cursor = 0;
  const lines = lyrics.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^\[[^\]]+\]$/.test(s));
  for (let i = 0; i < lines.length; i++) {
    const index = timings.findIndex((t, n) => n >= cursor && t.text === normal(lines[i]!));
    if (index >= 0) { matched.set(i, timings[index]!.at); cursor = index + 1; }
  }
  const from = matched.get(target.startLine);
  const to = target.endLine === lines.length ? duration : matched.get(target.endLine);
  return from !== undefined && to !== undefined && from >= 0 && to > from && to <= duration ? { from_s: from, to_s: to } : null;
}
export function replaceMusicSection(lyrics: string, section: string, replacement: string): string {
  const wanted = normal(section); let active = false; let replaced = false; const counts = new Map<string, number>();
  const out: string[] = [];
  for (const line of lyrics.split(/\r?\n/)) {
    const tag = /^\[([^\]]+)\]$/.exec(line.trim());
    if (tag) {
      const name = normal(tag[1]!); const count = (counts.get(name) ?? 0) + 1; counts.set(name, count);
      active = !replaced && (name === wanted || `${name} ${count}` === wanted || (count === 1 && `${name} 1` === `${wanted} 1`));
      out.push(line);
      if (active) { out.push(replacement.replace(/^\[[^\]]+\]\s*/, "")); replaced = true; }
    } else if (!active) out.push(line);
  }
  return out.join("\n");
}

/** The tool's measured singing rate: about 4 s a sung line plus 10 s (design note sections 16 and 18.1: 11 lines filled 55 s). */
export function sungSecondsFor(lines: number): number { return lines * 4 + 10; }
function isTag(line: string): boolean { return /^\[[^\]]+\]$/.test(line.trim()); }
/**
 * MUSIC-GEN-17 (design note 18.1): words longer than the song are squeezed into its last second by ACE-Step and sung as nonsense.
 * Keep whole sections from the top while their sung time fits the length; the first section with words always stays. Words
 * without section tags, or a first section that alone is too long, keep the lines that fit. `cut` says the words were longer than this song.
 */
export function fitLyricsToLength(lyrics: string, seconds: number): { lyrics: string; cut: boolean } {
  const rows = lyrics.split(/\r?\n/);
  const blocks: string[][] = [];
  for (const row of rows) {
    if (isTag(row) || !blocks.length) blocks.push([]);
    blocks.at(-1)!.push(row);
  }
  const sungIn = (block: string[]) => block.filter((row) => row.trim() && !isTag(row)).length;
  const kept: string[][] = []; let lines = 0;
  for (const block of blocks) {
    const sung = sungIn(block);
    if (sung && lines && sungSecondsFor(lines + sung) > seconds) break;
    if (sung && !lines && sungSecondsFor(sung) > seconds) {
      // Even the first section is too long: keep its lines that fit, at least one.
      const room = Math.max(1, Math.floor((seconds - 10) / 4)); let taken = 0;
      kept.push(block.filter((row) => !row.trim() || isTag(row) || taken++ < room));
      lines = room; break;
    }
    kept.push(block); lines += sung;
  }
  const out = kept.map((block) => block.join("\n").trim()).filter(Boolean).join("\n\n");
  const cut = kept.reduce((n, block) => n + sungIn(block), 0) < blocks.reduce((n, block) => n + sungIn(block), 0);
  return { lyrics: cut ? out : lyrics, cut };
}

export interface TimedLyric { t: number; line: string; section: string | null }
/**
 * The lines the engine really sang, from its own timed lyrics (`lrc`). When two or more lines share one timestamp in the last 1.5 s, ACE-Step
 * squeezed them in (Jesse's banana song put 12 sung lines at 0:59.92 of 60 s); those are left out of the card and the karaoke list.
 */
export function sungLyricsFromLrc(lrc: string, durationS: number | null, opts: { keepSqueezed?: boolean } = {}): TimedLyric[] {
  const out: TimedLyric[] = []; let section: string | null = null;
  for (const row of lrc.split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(row.trim()); if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]); const rest = m[3]!.trim();
    const tag = /^\[([^\]]+)\]$/.exec(rest);
    if (tag) { section = tag[1]!; continue; }
    if (rest) out.push({ t, line: rest, section });
  }
  if (opts.keepSqueezed) return out;
  // The squeeze signature (live 0:59.92, reproduced 0:58.56): two or more lines on one timestamp in the last 1.5 s. Everything from
  // the first such line on was squeezed.
  const end = durationS ?? (out.at(-1)?.t ?? 0);
  const first = out.findIndex((row, i) => row.t >= end - 1.5 && out.some((other, j) => j !== i && other.t === row.t));
  return first >= 0 ? out.slice(0, first) : out;
}
/** The words as sent, without their last `drop` sung lines (and any section tag left with no lines after it). */
export function withoutLastLines(words: string, drop: number): string {
  const rows = words.split(/\r?\n/);
  let left = drop;
  for (let i = rows.length - 1; i >= 0 && left > 0; i--) if (rows[i]!.trim() && !isTag(rows[i]!)) { rows.splice(i, 1); left--; }
  while (rows.length && (!rows.at(-1)!.trim() || isTag(rows.at(-1)!))) rows.pop();
  return rows.join("\n");
}
/** Plain lyrics for the card from the sung lines, one section header before each section's first line. */
export function lyricsTextOf(lines: TimedLyric[]): string {
  const parts: string[] = []; let last: string | null | undefined;
  for (const row of lines) {
    if (row.section !== last) { if (parts.length) parts.push(""); if (row.section) parts.push(`[${row.section}]`); last = row.section; }
    parts.push(row.line);
  }
  return parts.join("\n");
}
