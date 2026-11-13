// CREATOR-13 (CREATOR-PORT-2026-11-13): the picture presets (looks, lights, angles, formats) as `media_template` fragment records, and the
// one place that turns the chosen ones into words. The composer's Presets pill, the Images Create page and chat's picture tool all read the
// same records through lib/media/templates.ts and all compose through `composePicturePrompt`; nothing here is a second list.
import type { PersonRow } from "@/types";
import { getFragment, listFragments, type FragmentRecord } from "@/lib/media/templates";

/** The sentence a light ends with when it changes a picture the person already has (shared by all ten, one definition). */
export const RELIGHT_KEEP = "Only the light changes: keep the same place, subject, pose, outfit and framing.";
/** What every look says when it restyles a picture the person already has. */
const LOOK_KEEP = "Keep the same subject, pose and framing.";

export interface PictureFragmentPicks { look?: string; light?: string; angle?: string; format?: string }
export const PICTURE_PICK_KEYS = ["look", "light", "angle", "format"] as const;
const GROUP_OF: Record<keyof PictureFragmentPicks, FragmentRecord["group"]> = { look: "picture_look", light: "relight", angle: "angle", format: "format" };

/** The records behind the picks, or null when one id is not a preset of the right family or the person may not use it. */
export function resolvePicks(picks: PictureFragmentPicks, actor: PersonRow): Partial<Record<keyof PictureFragmentPicks, FragmentRecord>> | null {
  const out: Partial<Record<keyof PictureFragmentPicks, FragmentRecord>> = {};
  for (const key of PICTURE_PICK_KEYS) {
    const id = picks[key];
    if (!id || id === "none") continue;
    const row = getFragment(id);
    if (!row || row.group !== GROUP_OF[key] || !listFragments({ actor, group: row.group }).some((r) => r.id === row.id)) return null;
    out[key] = row;
  }
  return out;
}

/** Words for one picture: the person's own words, then the look, light, angle and format words in that order. A change to a picture the person
 * already has says what to keep. `aspect` is the chosen format's aspect when it has one (it sets the shape), else null. */
export function composePicturePrompt(base: string, picks: PictureFragmentPicks, options: { edit: boolean }, actor?: PersonRow): { prompt: string; aspect: string | null } {
  const rows = actor ? resolvePicks(picks, actor) : (() => { const o: Partial<Record<keyof PictureFragmentPicks, FragmentRecord>> = {}; for (const k of PICTURE_PICK_KEYS) { const row = picks[k] ? getFragment(picks[k]!) : null; if (row) o[k] = row; } return o; })();
  const words = PICTURE_PICK_KEYS.flatMap((key) => rows?.[key] ? [rows[key]!.prompt] : []);
  const aspect = rows?.format?.aspect ?? null;
  if (words.length === 0) return { prompt: base, aspect };
  const own = base.trim();
  let prompt = own ? `${own}, ${words.join(", ")}` : words.join(", ");
  if (options.edit) prompt = `${prompt}. ${[rows?.look ? LOOK_KEEP : "", rows?.light ? RELIGHT_KEEP : ""].filter(Boolean).join(" ")}`.trim();
  return { prompt, aspect };
}

const FAMILY_LABEL: Record<string, string> = { art: "Art", story: "Scenes", portrait: "People", product: "Products", other: "Colour" };
export interface PresetChip { id: string; label: string; default: string; options: Array<{ value: string; label: string }> }

/** The chips of the Presets pill, from the records: Look split by family (a Create page chip holds at most 24 options), then Light, Angle and Format.
 * Each starts at None, and a pick is a setting that rides with the job; it never replaces the person's words. */
export function pictureFragmentChips(actor: PersonRow): PresetChip[] {
  const none = { value: "none", label: "None" };
  const looks = listFragments({ actor, group: "picture_look" });
  const families = [...new Set(looks.map((row) => row.category))];
  const chip = (id: string, label: string, rows: FragmentRecord[]): PresetChip => ({ id, label, default: "none", options: [none, ...rows.map((row) => ({ value: row.id, label: row.title }))] });
  return [
    ...families.map((family) => chip(`look_${family}`, FAMILY_LABEL[family] ?? family, looks.filter((row) => row.category === family))),
    ...([["light", "Light", "relight"], ["angle", "Angle", "angle"], ["format", "Format", "format"]] as const).flatMap(([id, label, group]) => {
      const rows = listFragments({ actor, group });
      return rows.length ? [chip(id, label, rows)] : [];
    }),
  ];
}
