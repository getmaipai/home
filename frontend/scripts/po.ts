// Minimal .po reading and rewriting for the translation script and its tests. Lingui owns extraction; this only reads
// the blocks it wrote and rewrites msgstr and the `#, needs-review` flag, leaving every other byte alone.
export type PoEntry = { id: string; msgstr: string; refs: string[]; flags: string[]; start: number; end: number; /** The English text when the id is an explicit key (failure.busy.adult): en-US's msgstr. */ source?: string };

/** id -> English text for every entry whose id is a key rather than the text itself. */
export function englishSources(enUsPo: string): Map<string, string> {
  return new Map(parsePo(enUsPo).filter((entry) => entry.msgstr && entry.msgstr !== entry.id).map((entry) => [entry.id, entry.msgstr]));
}

const unquote = (line: string): string => JSON.parse(line.trim());

export function parsePo(text: string): PoEntry[] {
  const entries: PoEntry[] = [];
  const blocks = text.split(/\n{2,}/);
  let offset = 0;
  for (const block of blocks) {
    const start = text.indexOf(block, offset);
    offset = start + block.length;
    const lines = block.split("\n");
    const refs: string[] = [];
    let flags: string[] = [];
    let id = "";
    let msgstr = "";
    let mode: "id" | "str" | null = null;
    let sawId = false;
    for (const line of lines) {
      if (line.startsWith("#:")) refs.push(...line.slice(2).trim().split(/\s+/).filter(Boolean));
      else if (line.startsWith("#,")) flags = line.slice(2).split(",").map((flag) => flag.trim()).filter(Boolean);
      else if (line.startsWith("msgid ")) { mode = "id"; sawId = true; id = unquote(line.slice(6)); }
      else if (line.startsWith("msgstr ")) { mode = "str"; msgstr = unquote(line.slice(7)); }
      else if (line.startsWith('"')) { if (mode === "id") id += unquote(line); else if (mode === "str") msgstr += unquote(line); }
    }
    if (sawId && id !== "") entries.push({ id, msgstr, refs, flags, start, end: offset });
  }
  return entries;
}

const quote = (value: string) => JSON.stringify(value);

/** Rewrite one entry's block: set msgstr (when given) and add or remove the needs-review flag. */
export function rewriteEntry(text: string, entry: PoEntry, change: { msgstr?: string; flag?: boolean }): string {
  const lines = text.slice(entry.start, entry.end).split("\n");
  const out: string[] = [];
  let flags = [...entry.flags];
  if (change.flag === true && !flags.includes("needs-review")) flags.push("needs-review");
  if (change.flag === false) flags = flags.filter((flag) => flag !== "needs-review");
  let wroteFlags = false;
  let skippingStr = false;
  for (const line of lines) {
    if (line.startsWith("#,")) continue;
    if (line.startsWith("msgid ") && !wroteFlags) {
      if (flags.length) out.push(`#, ${flags.join(", ")}`);
      wroteFlags = true;
    }
    if (line.startsWith("msgstr ") && change.msgstr !== undefined) { out.push(`msgstr ${quote(change.msgstr)}`); skippingStr = true; continue; }
    if (skippingStr && line.startsWith('"')) continue;
    if (!line.startsWith('"')) skippingStr = false;
    out.push(line);
  }
  return text.slice(0, entry.start) + out.join("\n") + text.slice(entry.end);
}

/** Apply many changes without invalidating offsets: later blocks first. */
export function rewriteEntries(text: string, changes: Map<string, { msgstr?: string; flag?: boolean }>): string {
  const entries = parsePo(text).filter((entry) => changes.has(entry.id)).sort((a, b) => b.start - a.start);
  let out = text;
  for (const entry of entries) out = rewriteEntry(out, entry, changes.get(entry.id)!);
  return out;
}
