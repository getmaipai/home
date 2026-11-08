import { languageName } from "./languages";
import { validateTranslation } from "./validate";
import { findKeepSpans, loadKeepTerms, maskKept, spotKeepTerms } from "./keep";

export type Kind = "subtitle" | "lyric" | "ui" | "doc" | "chat";
export const DEFAULT_BATCH: Record<Kind, number> = { subtitle: 20, lyric: 18, ui: 150, doc: 20, chat: 20 };
export type Completer = (messages: { role: "system" | "user"; content: string }[]) => Promise<{ ok: true; text: string } | { ok: false }>;
export class TranslateHeldError extends Error {
  constructor(message: string) { super(message); this.name = "TranslateHeldError"; }
}

const KIND_INSTRUCTIONS: Record<Kind, string> = {
  subtitle: "Keep subtitle lines short.",
  lyric: "Keep the meaning and line count.",
  ui: "Translate product copy and keep {placeholders} and <0/> tags unchanged.",
  doc: "Keep the meaning and tone.",
  chat: "Translate a single phrase.",
};

function parseReply(raw: string, expected: number): string[] | null {
  try {
    const body = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let value: unknown = JSON.parse(body);
    // Some models wrap the array in an object such as {"result": [...]}; accept a single array-valued property.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const arrays = Object.values(value as Record<string, unknown>).filter(Array.isArray);
      if (arrays.length === 1) value = arrays[0];
    }
    if (!Array.isArray(value) || value.length !== expected || !value.every((item) => typeof item === "string" && item.trim().length > 0)) return null;
    return value.map((item: string) => item.trim());
  } catch { return null; }
}

/** The glossary's curated words for one target language: {Library: {es: "Biblioteca"}}. */
function glossaryWords(glossary: Record<string, unknown> | undefined, to: string): Array<[string, string]> {
  const words: Array<[string, string]> = [];
  for (const [term, value] of Object.entries(glossary ?? {})) {
    // Only the curated per-language entries ({es: "Biblioteca"}) are enforced; plain string hints (bold UI labels) only guide the prompt,
    // because a verb form such as "Búscalo" for "Search it" is correct without the label word.
    const word = value && typeof value === "object" ? (value as Record<string, unknown>)[to] : undefined;
    if (typeof word === "string" && word.trim() && term.length > 1) words.push([term, word.trim()]);
  }
  return words;
}

export async function translateItems(options: {
  items: string[]; from: string; to: string; kind: Kind; completer: Completer;
  keep?: string[]; spot?: boolean;
  glossary?: Record<string, unknown>; accept?: (source: string, out: string) => boolean; dialect?: string; style?: string[]; check?: (outs: string[]) => string | null;
  batchSize?: number; onProgress?: (done: number, total: number) => void;
}): Promise<{ results: (string | null)[]; failed: number[]; newTerms: string[] }> {
  const { items, kind, completer } = options;
  const results: (string | null)[] = Array(items.length).fill(null);
  const failed: number[] = [];
  const size = options.batchSize ?? DEFAULT_BATCH[kind];
  const from = languageName(options.from) ?? options.from;
  const to = languageName(options.to) ?? options.to;
  const fixedTerms = loadKeepTerms(kind, options.keep);
  const shouldSpot = (kind === "ui" || kind === "doc") && options.spot === true;
  const spotted: string[] = [];
  if (shouldSpot) {
    for (let at = 0; at < items.length; at += size) {
      for (const term of await spotKeepTerms(items.slice(at, at + size), completer, from)) {
        if (!spotted.includes(term) && !Object.prototype.hasOwnProperty.call(options.glossary ?? {}, term)) spotted.push(term);
      }
    }
  }
  const terms = loadKeepTerms(kind, [...(options.keep ?? []), ...spotted]);
  const newTerms = spotted.filter((term) => !fixedTerms.includes(term));
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const masks = batch.map((item) => maskKept(item, findKeepSpans(item, terms, { acronyms: kind === "ui" || kind === "doc" || kind === "chat" })));
    const maskedBatch = masks.map((entry) => entry.masked);
    const system = [`Translate from ${from} to ${to}. ${KIND_INSTRUCTIONS[kind]}`, `Return only a JSON array of exactly ${batch.length} strings, in the same order.`, "Text like ⟦K1⟧ is a fixed marker: copy it exactly, unchanged, once."];
    if (options.dialect) system.push(`Dialect: ${options.dialect}`);
    if (options.style?.length) system.push(`Style rules: ${options.style.join("; ")}`);
    if (options.glossary) system.push(`Glossary terms to use: ${JSON.stringify(options.glossary)}`);
    const systemContent = system.join(" ");
    const messages = [{ role: "system" as const, content: systemContent }, { role: "user" as const, content: JSON.stringify(maskedBatch) }];
    const call = async (texts: string[]): Promise<string[] | null> => {
      const response = await completer(texts === batch ? messages : [
        { role: "system", content: systemContent.replace(`exactly ${batch.length}`, `exactly ${texts.length}`) },
        { role: "user", content: JSON.stringify(texts) },
      ]);
      return response.ok ? parseReply(response.text, texts.length) : null;
    };
    // A glossary term that appears in the source (outside kept spans) must come back as its chosen word.
    const wanted = (kind === "ui" || kind === "doc") ? glossaryWords(options.glossary, options.to) : [];
    const valid = (outs: string[], sources: string[], at: number[] = sources.map((_, i) => i)): boolean => outs.every((out, i) => {
      if (validateTranslation(sources[i]!, out, kind) !== null) return false;
      if (options.accept && !options.accept(sources[i]!, out)) return false;
      const visible = masks[at[i]!]?.masked ?? sources[i]!;
      return wanted.every(([term, word]) => !new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(visible) || out.toLowerCase().includes(word.toLowerCase()));
    });
    const checked = (outs: string[]): void => {
      const reason = options.check?.(outs);
      if (reason !== undefined && reason !== null) throw new TranslateHeldError(reason);
    };
    const translateMasked = async (texts: string[], indices: number[]): Promise<string[] | null> => {
      const translated = await call(texts);
      if (!translated) return null;
      const restored = translated.map((out, i) => masks[indices[i]!]!.restore(out));
      return restored.every((out): out is string => out !== null) ? restored : null;
    };
    let outs: string[] | null = await translateMasked(maskedBatch, batch.map((_, i) => i));
    if (kind !== "ui" && (!outs || !valid(outs, batch))) outs = await translateMasked(maskedBatch, batch.map((_, i) => i));
    if (outs && valid(outs, batch)) {
      checked(outs);
      outs.forEach((out, i) => { results[start + i] = out; });
    } else {
      for (let i = 0; i < batch.length; i += 1) {
        const source = batch[i]!;
        const single = await translateMasked([maskedBatch[i]!], [i]);
        if (single && valid(single, [source], [i])) {
          checked(single);
          results[start + i] = single[0]!;
        }
        else failed.push(start + i);
      }
    }
    options.onProgress?.(Math.min(start + batch.length, items.length), items.length);
  }
  return { results, failed, newTerms };
}
