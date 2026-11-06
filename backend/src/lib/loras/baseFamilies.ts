// The ONE lookup table of the model bases the style (LoRA) browser knows (owner ruling 2026-11-03: never hard-code the model families; machines and engines differ).
// One row per family, one row per base inside it: the Civitai `baseModels` labels, the text patterns that read a base from a name or a Hugging Face tag, the plain words,
// and whether Home can install styles for it. `source.ts`, `install.ts`, `sync.ts` and `routes/lorasSources.ts` read this file and name no base or label themselves.
//
// Video Civitai labels were confirmed live 2026-11-03 against the public API. Retired 2.3 is recognized only so old records can be refused safely;
// 2.5 and generic LTXV2 results remain searchable. `LTXV` is LTX video v1 and is deliberately in no row. Wan's label is unconfirmed.
// Picture labels were confirmed live against the public API 2026-11-05: `Flux.2 Klein 4B`, `ZImageTurbo`, and `Ernie`. Klein 9B, Flux.2 D and ZImageBase are different bases.
//
// "Supported on this install" is `supportedBaseIds()`: the installable bases its video and picture engines report can use styles right now. An unknown engine status falls back to every
// installable base for that call, so a Stack hiccup never makes the browser silently empty. A different machine or engine changes the answer through the provider, with no edit here.

export const BASE_FAMILIES = [
  {
    id: "ltx-2", name: "LTX", media: "video",
    /** The family's own generic label: a hit with it names no version, so the version is read from its text, and never guessed. */
    genericLabels: ["LTXV2"],
    bases: [
      { id: "ltx-2.5", browse: "ltx-2.5", labels: ["LTXV 2.5"], patterns: [/ltx[\s_-]*(?:v|video)?[\s_-]*2[._-]?5/], words: "LTX 2.5", short: "LTX-2.5", installable: true },
      { id: "ltx-2.3", browse: "ltx-2.3", labels: [], patterns: [/ltx[\s_-]*(?:v|video)?[\s_-]*2[._-]?3/], words: "retired video base", short: "retired video base", installable: false },
    ],
  },
  {
    id: "wan", name: "Wan", media: "video", genericLabels: [] as string[],
    bases: [
      { id: "wan2.2-ti2v-5b", browse: "wan", labels: ["Wan Video 2.2 TI2V-5B"], patterns: [/\bwan/], words: "Wan", short: "Wan", installable: false },
    ],
  },
  {
    id: "flux", name: "Flux", media: "picture", genericLabels: [] as string[],
    bases: [
      { id: "flux2-klein-4b", browse: "flux2-klein-4b", labels: ["Flux.2 Klein 4B"], patterns: [/flux[\s._-]*2[\s._-]*klein[\s._-]*4[\s._-]*b/], words: "Flux", short: "Flux.2 Klein 4B", installable: true },
    ],
  },
  {
    id: "z-image", name: "Z-Image", media: "picture", genericLabels: [] as string[],
    bases: [
      { id: "z-image-turbo", browse: "z-image-turbo", labels: ["ZImageTurbo"], patterns: [/z[\s._-]*image[\s._-]*turbo/], words: "Z-Image", short: "Z-Image Turbo", installable: true },
    ],
  },
  {
    id: "ernie", name: "ERNIE", media: "picture", genericLabels: [] as string[],
    bases: [
      { id: "ernie-image-turbo", browse: "ernie-image-turbo", labels: ["Ernie"], patterns: [/\bernie\b/], words: "ERNIE", short: "ERNIE", installable: true },
    ],
  },
] as const;

type Row = (typeof BASE_FAMILIES)[number]["bases"][number];
/** Every concrete base id the table names. */
export type AnyBaseId = Row["id"];
/** Bases represented by the older video-only spec record. */
export type BaseId = "ltx-2.5" | "ltx-2.3" | "wan2.2-ti2v-5b";
/** The `browse` values a search may ask for, besides "default" and "all". */
export type BrowseBase = Row["browse"];
export type Media = "video" | "picture";

type FamilyRow = Row & { family: string; media: Media };
const ROWS: readonly FamilyRow[] = BASE_FAMILIES.flatMap((f) => f.bases.map((b) => ({ ...b, family: f.id as string, media: f.media })));
export const ALL_BASE_IDS: readonly AnyBaseId[] = ROWS.map((r) => r.id);
export const BROWSE_BASES: Readonly<Record<Media, readonly BrowseBase[]>> = {
  video: ROWS.filter((r) => r.media === "video" && r.installable).map((r) => r.browse),
  picture: ROWS.filter((r) => r.media === "picture").map((r) => r.browse),
};
/** The bases an install may name when the source does not say (every installable one; the tuple form is for zod). */
export const INSTALLABLE_BASE_IDS = installableBaseIds("video") as [BaseId, ...BaseId[]];
/** The table's installable bases for one media kind. */
export function installableBaseIds(media: Media): AnyBaseId[] {
  return ROWS.filter((r) => r.media === media && r.installable).map((r) => r.id);
}

/** Which media a base belongs to (video or picture), or null for an id the table does not know. */
export const mediaOfBase = (id: string): Media | null => ROWS.find((r) => r.id === id)?.media ?? null;

const rowOf = (id: string): FamilyRow | undefined => ROWS.find((r) => r.id === id);

let provider: (() => ReadonlySet<string> | null) | null = null;
/** Feed the bases the household's installed engines can use. A null provider result means unknown and allows every installable base for that call. */
export function setInstalledBasesProvider(fn: (() => ReadonlySet<string> | null) | null): void { provider = fn; }

/** The bases supported on this install: installable here AND (when a provider is set) made by an engine the household has. */
export function supportedBaseIds(media: Media = "video"): AnyBaseId[] {
  const have = provider ? provider() : null;
  return ROWS.filter((r) => r.media === media && r.installable && (have === null || have.has(r.id))).map((r) => r.id);
}
export const isSupportedBase = (id: string, media: Media = "video"): id is AnyBaseId => (supportedBaseIds(media) as string[]).includes(id);

/** Every base the text names, in table order (a name, a version name, a description or a Hugging Face base tag). */
export function basesNamedIn(text: string, only?: readonly string[]): AnyBaseId[] {
  const t = text.toLowerCase();
  return ROWS.filter((r) => (!only || only.includes(r.id)) && r.patterns.some((p) => p.test(t))).map((r) => r.id);
}

/** The base a text names (the first in table order), or "unknown". */
export const baseFromText = (text: string): AnyBaseId | "unknown" => basesNamedIn(text)[0] ?? "unknown";

/** What a Civitai base label means: a concrete base, a generic family label (version to be read from text), or neither. */
export function civitaiLabel(label: string, media?: Media): { kind: "base"; id: AnyBaseId } | { kind: "generic"; candidates: AnyBaseId[] } | { kind: "other" } {
  const row = ROWS.find((r) => (!media || r.media === media) && (r.labels as readonly string[]).includes(label));
  if (row) return { kind: "base", id: row.id };
  const fam = BASE_FAMILIES.find((f) => (!media || f.media === media) && (f.genericLabels as readonly string[]).includes(label));
  return fam ? { kind: "generic", candidates: fam.bases.map((b) => b.id) } : { kind: "other" };
}

/** The Civitai `baseModels` strings to ask for: for "default" every supported base and its family's generic labels; for one browse base, that base and its family's generic labels. */
export function civitaiLabelsFor(browse: "default" | "all" | BrowseBase, media: Media = "video"): string[] {
  if (browse === "all") return [];
  const ids = browse === "default" ? supportedBaseIds(media) : ROWS.filter((r) => r.media === media && r.browse === browse).map((r) => r.id);
  const labels: string[] = [];
  for (const f of BASE_FAMILIES.filter((family) => family.media === media)) {
    const mine = f.bases.filter((b) => (ids as string[]).includes(b.id));
    if (!mine.length) continue;
    for (const b of mine) labels.push(...b.labels);
    labels.push(...f.genericLabels);
  }
  return labels;
}

/** The concrete bases a search of this kind wants (for "all", every one). */
export function wantedBaseIds(browse: "default" | "all" | BrowseBase, media: Media = "video"): AnyBaseId[] {
  if (browse === "all") return ROWS.filter((r) => r.media === media).map((r) => r.id);
  if (browse === "default") return supportedBaseIds(media);
  return ROWS.filter((r) => r.media === media && r.browse === browse).map((r) => r.id);
}

/** The base a browse value names, e.g. "wan" is Wan's id. */
export const baseOfBrowse = (browse: BrowseBase): AnyBaseId => ROWS.find((r) => r.browse === browse)!.id;

/** Plain words for a base id ("an unknown base" for anything else). */
export const baseWords = (id: string): string => rowOf(id)?.words ?? "an unknown base";
export const baseShort = (id: string): string => rowOf(id)?.short ?? "an unknown base";
/** The family names the household can install for, as "LTX" or "LTX or Wan". Used in the not-supported sentence. */
export function supportedFamilyWords(media: Media = "video"): string {
  const supported = supportedBaseIds(media);
  const names = BASE_FAMILIES.filter((f) => f.media === media && f.bases.some((b) => supported.includes(b.id))).map((f) => f.name);
  return names.length ? names.join(" or ") : media === "video" ? "no video model" : "no picture model";
}
