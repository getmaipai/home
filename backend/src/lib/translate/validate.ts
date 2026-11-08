import type { Kind } from "./core";

const tokens = (value: string): string[] => [...(value.match(/\{\s*\w+(?=\s*[,}])|<\/?\d+\/?>/g) ?? [])].map((token) => token.replace(/\s+/g, "")).sort();

export function validateTranslation(source: string, out: string, kind: Kind): string | null {
  if (!out.trim()) return "empty";
  if (out.includes("\u2014")) return "em dash";
  if (out.includes("!") && !source.includes("!")) return "exclamation point";
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(out))) return "placeholders differ";
  if (out.length > source.length * 3 + 20) return "too long";
  if (kind === "subtitle" && out.length > 120) return "subtitle too long";
  if ((kind === "subtitle" || kind === "lyric") && /[\r\n]/.test(out)) return "newline";
  return null;
}

const PROTECTED = /child|teen|minor|crisis|consent|refusal|spoken|robot|SEARCH-DOWN-EMPTY-01/i;

/** Apply only to catalog ids and source refs, never caption, lyric, or document text. */
export function isProtected(refs: string[], id: string): boolean {
  return PROTECTED.test(`${refs.join(" ")} ${id}`);
}
