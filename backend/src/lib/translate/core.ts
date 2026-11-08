import { languageName } from "./languages";
import { validateTranslation } from "./validate";

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
    const value: unknown = JSON.parse(body);
    if (!Array.isArray(value) || value.length !== expected || !value.every((item) => typeof item === "string" && item.trim().length > 0)) return null;
    return value.map((item: string) => item.trim());
  } catch { return null; }
}

export async function translateItems(options: {
  items: string[]; from: string; to: string; kind: Kind; completer: Completer;
  glossary?: Record<string, unknown>; check?: (outs: string[]) => string | null;
  batchSize?: number; onProgress?: (done: number, total: number) => void;
}): Promise<{ results: (string | null)[]; failed: number[] }> {
  const { items, kind, completer } = options;
  const results: (string | null)[] = Array(items.length).fill(null);
  const failed: number[] = [];
  const size = options.batchSize ?? DEFAULT_BATCH[kind];
  const from = languageName(options.from) ?? options.from;
  const to = languageName(options.to) ?? options.to;
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const system = [`Translate from ${from} to ${to}. ${KIND_INSTRUCTIONS[kind]}`, `Return only a JSON array of exactly ${batch.length} strings, in the same order.`];
    if (options.glossary) system.push(`Glossary terms to use: ${JSON.stringify(options.glossary)}`);
    const systemContent = system.join(" ");
    const messages = [{ role: "system" as const, content: systemContent }, { role: "user" as const, content: JSON.stringify(batch) }];
    const call = async (texts: string[]): Promise<string[] | null> => {
      const response = await completer(texts === batch ? messages : [
        { role: "system", content: systemContent.replace(`exactly ${batch.length}`, `exactly ${texts.length}`) },
        { role: "user", content: JSON.stringify(texts) },
      ]);
      return response.ok ? parseReply(response.text, texts.length) : null;
    };
    const valid = (outs: string[], sources: string[]): boolean => outs.every((out, i) => validateTranslation(sources[i]!, out, kind) === null);
    const checked = (outs: string[]): void => {
      const reason = options.check?.(outs);
      if (reason !== undefined && reason !== null) throw new TranslateHeldError(reason);
    };
    let outs: string[] | null = await call(batch);
    if (kind !== "ui" && (!outs || !valid(outs, batch))) outs = await call(batch);
    if (outs && valid(outs, batch)) {
      checked(outs);
      outs.forEach((out, i) => { results[start + i] = out; });
    } else {
      for (let i = 0; i < batch.length; i += 1) {
        const source = batch[i]!;
        const single = await call([source]);
        if (single && valid(single, [source])) {
          checked(single);
          results[start + i] = single[0]!;
        }
        else failed.push(start + i);
      }
    }
    options.onProgress?.(Math.min(start + batch.length, items.length), items.length);
  }
  return { results, failed };
}
