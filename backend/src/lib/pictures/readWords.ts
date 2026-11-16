// TEXT-PIC-05 (Home side): read the words on a finished picture with the household's local vision model and compare them,
// exactly, with the words the person asked for (docs/design/text-in-pictures-2026-11-14.md, "The spelling check (W4)").
// It uses the age check's own transport (ageCheck.askPictureModel: same reader choice, memory guard, deadline and failure
// kinds), never a second model client. A check that cannot run never blocks a picture; it says "checked: no".
import { askPictureModel, type CheckFailure, type VisionAsk } from "./ageCheck";

export type ReadWordsResult = { ok: true; lines: string[] } | { ok: false; why: CheckFailure };

export const READ_WORDS_SCHEMA = {
  name: "picture_text",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["lines"],
    properties: { lines: { type: "array", maxItems: 40, items: { type: "string", maxLength: 200 } } },
  },
} as const;

const READ_WORDS_ASK: VisionAsk = {
  system: "You read the text printed on a picture. Answer with a single JSON object and nothing else. Copy each letter exactly as it appears, even when a word looks misspelled. Never correct, complete or guess a word, and never describe the picture.",
  user: "List every line of text you can read on this picture, exactly as written, in order.",
  schema: READ_WORDS_SCHEMA as unknown as VisionAsk["schema"],
  maxTokens: 400,
  maxSide: 1280,
};

/** Reads the model's text into lines, or null when it is not a usable answer. */
export function parseWordLines(text: string): string[] | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(body) as { lines?: unknown };
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.some((line) => typeof line !== "string")) return null;
    return (parsed.lines as string[]).map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Test seam: replaces the whole read (null restores). */
let runnerForTests: ((bytes: Uint8Array) => Promise<ReadWordsResult>) | null = null;
export function __setReadWordsRunnerForTests(fn: ((bytes: Uint8Array) => Promise<ReadWordsResult>) | null): void { runnerForTests = fn; }

/** The lines of text the local vision model reads on this picture. Never throws. */
export async function readPictureWords(imageBytes: Uint8Array): Promise<ReadWordsResult> {
  if (runnerForTests) return runnerForTests(imageBytes);
  const answer = await askPictureModel(imageBytes, READ_WORDS_ASK);
  if (!answer.ok) return answer;
  const lines = parseWordLines(answer.text);
  return lines ? { ok: true, lines } : { ok: false, why: "unparsed" };
}

/** Case, spacing and punctuation aside, nothing else: "Grand  Opening!" and "grand opening" are the same, "Grnad Opening" is not. */
export function normalizeWords(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The required strings that do not appear in what was read. A required string may sit inside a longer line, or run across two lines that follow each other. Empty required passes. */
export function compareWords(required: readonly string[], found: readonly string[]): string[] {
  const lines = found.map(normalizeWords).filter(Boolean);
  const joined = lines.join("");
  return required.filter((word) => {
    const wanted = normalizeWords(word);
    if (!wanted) return false;
    return !(lines.some((line) => line.includes(wanted)) || joined.includes(wanted));
  });
}
