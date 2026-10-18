import { generationOf } from "@/lib/music/types";
const WRITERS = ["picture-gen", "image-edit", "video-gen", "video-poster", "music-gen"];
/** The five shipped generation writers. Unknown and malformed notes carry no metadata. */
export function libraryProvenance(note: string): Record<string, unknown> & { writer?: string } {
  const writer = WRITERS.find(prefix => note.startsWith(`${prefix}:`));
  if (!writer) return {};
  try {
    const value: unknown = JSON.parse(note.slice(writer.length + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? { ...value, writer } : {};
  } catch { return {}; }
}

/** SQL form for the listing, guarded before any JSON extraction. */
export function libraryProvenanceSql(column: string): string {
  return `(CASE ${WRITERS.map(writer => {
    const payload = `substr(${column},${writer.length + 2})`;
    return `WHEN substr(${column},1,${writer.length + 1}) = '${writer}:' AND json_valid(${payload}) THEN json_set(CASE WHEN json_type(${payload}) = 'object' THEN ${payload} ELSE '{}' END,'$.writer','${writer}')`;
  }).join(" ")} ELSE '{}' END)`;
}

/** A file Home made (a picture, video, edit, poster or song), by the note its writer left in provenance (the one source;
 * the stored origin is only "sent" or "fetched"). */
export function isGeneratedFile(row: { origin: string; provenance: string }): boolean {
  return Boolean(libraryProvenance(row.provenance).writer) || generationOf(row.provenance) !== null;
}
