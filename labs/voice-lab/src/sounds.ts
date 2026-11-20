import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// Real non-word sounds (laughs, sighs, coughs, breaths), cut from recordings of the SAME speaker the voice was cloned from, spliced into the
// reply where the chat model wrote the tag. The voice model cannot make these itself. A voice with no recordings makes silence (the tag is
// skipped, and the prompt never offers it the tag).
export const SOUND_DIR = Bun.env.LAB_SOUNDS ?? join(import.meta.dir, "..", "engines", "sounds");
export type Sound = { pcm: Int16Array; seconds: number; level: number | null; kind: string; file: string };
const KIND_OF_TAG: Record<string, string> = { laugh: "laugh", chuckle: "laugh", sigh: "sigh", gasp: "breath", breath: "breath", cough: "cough", "clear throat": "throat" };
const cache = new Map<string, Record<string, Sound[]>>();

/** "casual_mild_happy" and "casual" share the recordings in sounds/casual. */
export function soundVoice(voice: string, dir = SOUND_DIR): string | null {
  for (const v of [voice, voice.split("_")[0]!]) if (v && existsSync(join(dir, v, "index.json"))) return v;
  return null;
}
export function loadSounds(voice: string, dir = SOUND_DIR): Record<string, Sound[]> {
  const base = soundVoice(voice, dir); if (!base) return {};
  const key = `${dir}/${base}`; const hit = cache.get(key); if (hit) return hit;
  const index = JSON.parse(readFileSync(join(dir, base, "index.json"), "utf8")) as Record<string, { kind: string; seconds: number; level_vs_speech: number | null; use?: boolean }>;
  const out: Record<string, Sound[]> = {};
  for (const file of readdirSync(join(dir, base))) {
    const meta = index[file]; if (!meta || meta.use === false) continue;
    const b = readFileSync(join(dir, base, file)); const pcm = new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length - ((b.length - 44) % 2)));
    (out[meta.kind] ??= []).push({ pcm, seconds: pcm.length / 24000, level: meta.level_vs_speech, kind: meta.kind, file });
  }
  cache.set(key, out); return out;
}
/** The sound tags this voice can really make: the only ones the chat model is told about. */
export function availableTags(voice: string, dir = SOUND_DIR): string[] {
  const lib = loadSounds(voice, dir); return Object.entries(KIND_OF_TAG).filter(([, kind]) => (lib[kind]?.length ?? 0) > 0).map(([tag]) => tag);
}
let last = new Map<string, string>();
/** A sound for a tag, level-matched to the voice's current speech loudness (rms, 0 to 1), never the same file twice in a row. */
export function pickSound(voice: string, tag: string, speechRms: number, dir = SOUND_DIR, rnd = Math.random): Int16Array | null {
  const kind = KIND_OF_TAG[tag]; if (!kind) return null;
  let options = (loadSounds(voice, dir)[kind] ?? []);
  if (tag === "chuckle") { const short = options.filter((s) => s.seconds <= 1.0); if (short.length) options = short; }
  if (tag === "gasp") { const short = options.filter((s) => s.seconds <= 0.6); if (short.length) options = short; }
  if (!options.length) return null;
  const prev = last.get(`${voice}:${kind}`); const fresh = options.filter((s) => s.file !== prev); const pool = fresh.length ? fresh : options;
  const s = pool[Math.floor(rnd() * pool.length)]!; last.set(`${voice}:${kind}`, s.file);
  let sum = 0; for (const v of s.pcm) sum += (v / 32768) ** 2; const own = Math.sqrt(sum / Math.max(1, s.pcm.length)) || 1e-6;
  const target = Math.min(0.35, Math.max(0.02, speechRms * Math.min(1.2, Math.max(0.3, s.level ?? 0.6))));
  const gain = Math.min(8, target / own); const out = new Int16Array(s.pcm.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(s.pcm[i]! * gain)));
  return out;
}
