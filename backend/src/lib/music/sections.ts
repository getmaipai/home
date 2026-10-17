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
