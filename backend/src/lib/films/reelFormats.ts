import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const range = z.tuple([z.number().int(), z.number().int()]).refine(([min, max]) => min <= max);
const reelFormatSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), summary: z.string().min(1), aspect: z.literal("9:16"),
  seconds: range, beats: range.refine(([min, max]) => min >= 5 && max <= 12),
  arc: z.array(z.string().min(1)).min(5).max(8), rules: z.array(z.string().min(1)).min(2).max(4), audience: z.literal("all-ages"),
});
const reelPresetSchema = z.object({ id: z.string().min(1), title: z.string().min(1), summary: z.string().min(1), look: z.string().min(1), pace: z.string().min(1), music_hint: z.string().min(1), caption_style: z.string().min(1) });
export type ReelFormat = z.infer<typeof reelFormatSchema>;
export type ReelPreset = z.infer<typeof reelPresetSchema>;

let formats: ReelFormat[] | undefined;
let presets: ReelPreset[] | undefined;
function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const parsed = z.array(schema).parse(JSON.parse(readFileSync(join(import.meta.dir, `../../../packages/make_film/film/${file}`), "utf8")));
  const ids = new Set<string>();
  for (const item of parsed) {
    const id = (item as { id: string }).id;
    if (ids.has(id)) throw new Error(`Duplicate reel data id: ${id}`);
    ids.add(id);
  }
  return parsed;
}
export function listReelFormats(): ReelFormat[] { return formats ??= load("formats.json", reelFormatSchema); }
export function getReelFormat(id: string): ReelFormat | undefined { return listReelFormats().find((item) => item.id === id); }
export function listReelPresets(): ReelPreset[] { return presets ??= load("presets.json", reelPresetSchema); }
export function getReelPreset(id: string): ReelPreset | undefined { return listReelPresets().find((item) => item.id === id); }
