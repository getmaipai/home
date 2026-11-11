// PACK-06b: the pronouncing dictionary the browser's mouth-cue builder needs, served once and cached by the browser.
// Words map to space-separated phonemes with the stress digits already removed (the cue builder ignores them); the
// numbered alternate pronunciations ("a(2)") are dropped, so the first listed pronunciation wins.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export type SpeechDictionary = { json: Buffer; gzip: Buffer; etag: string };
let cached: SpeechDictionary | null = null;

export async function speechDictionary(): Promise<SpeechDictionary> {
  if (cached) return cached;
  const { dictionary } = await import("cmu-pronouncing-dictionary");
  const out: Record<string, string> = {};
  for (const [word, phones] of Object.entries(dictionary)) if (!word.includes("(")) out[word] = phones.replace(/\d/g, "");
  const json = Buffer.from(JSON.stringify(out));
  cached = { json, gzip: gzipSync(json, { level: 9 }), etag: `"cmu-${createHash("sha256").update(json).digest("hex").slice(0, 16)}"` };
  return cached;
}
