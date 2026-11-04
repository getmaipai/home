// The ONE lookup table of the model bases the style (LoRA) browser knows (owner ruling 2026-11-03: never hard-code the model families; machines and engines differ).
// One row per family, one row per base inside it: the Civitai `baseModels` labels, the text patterns that read a base from a name or a Hugging Face tag, the plain words,
// and whether Home can install styles for it. `source.ts`, `install.ts`, `sync.ts` and `routes/lorasSources.ts` read this file and name no base or label themselves.
//
// Civitai labels were confirmed live 2026-11-03 against the public API: `LTXV 2.3` (97 styles), `LTXV 2.5` (32) and `LTXV2` (56, the generic LTX 2 family label: the version is
// only in the name, version name or description). `LTXV` (44) is LTX video v1 and is deliberately in no row. Wan's label is unconfirmed.
//
// "Supported on this install" is `supportedBaseIds()`: the bases whose engine this computer actually has. Until the video readiness feeds `setInstalledBasesProvider`, it is every
// base marked `installable` (Home can only install styles for those). A different machine or engine changes the answer through the provider, with no edit here.

export const BASE_FAMILIES = [
  {
    id: "ltx-2", name: "LTX",
    /** The family's own generic label: a hit with it names no version, so the version is read from its text, and never guessed. */
    genericLabels: ["LTXV2"],
    bases: [
      { id: "ltx-2.5", browse: "ltx-2.5", labels: ["LTXV 2.5"], patterns: [/ltx[\s_-]*(?:v|video)?[\s_-]*2[._-]?5/], words: "LTX 2.5", short: "LTX-2.5", installable: true },
      { id: "ltx-2.3", browse: "ltx-2.3", labels: ["LTXV 2.3"], patterns: [/ltx[\s_-]*(?:v|video)?[\s_-]*2[._-]?3/], words: "LTX 2.3", short: "LTX-2.3", installable: true },
    ],
  },
  {
    id: "wan", name: "Wan", genericLabels: [] as string[],
    bases: [
      { id: "wan2.2-ti2v-5b", browse: "wan", labels: ["Wan Video 2.2 TI2V-5B"], patterns: [/\bwan/], words: "Wan", short: "Wan", installable: false },
    ],
  },
] as const;

type Row = (typeof BASE_FAMILIES)[number]["bases"][number];
/** Every concrete base id the table names. */
export type BaseId = Row["id"];
/** The `browse` values a search may ask for, besides "default" and "all". */
export type BrowseBase = Row["browse"];

const ROWS: readonly (Row & { family: string })[] = BASE_FAMILIES.flatMap((f) => f.bases.map((b) => ({ ...b, family: f.id as string })));
export const ALL_BASE_IDS: readonly BaseId[] = ROWS.map((r) => r.id);
export const BROWSE_BASES: readonly BrowseBase[] = ROWS.map((r) => r.browse);
/** The bases an install may name when the source does not say (every installable one; the tuple form is for zod). */
export const INSTALLABLE_BASE_IDS = ROWS.filter((r) => r.installable).map((r) => r.id) as unknown as [BaseId, ...BaseId[]];

const rowOf = (id: string): (Row & { family: string }) | undefined => ROWS.find((r) => r.id === id);

let provider: (() => ReadonlySet<string>) | null = null;
/** Feed the bases the household's installed engines can use. `null` goes back to every installable base. */
export function setInstalledBasesProvider(fn: (() => ReadonlySet<string>) | null): void { provider = fn; }

/** The bases supported on this install: installable here AND (when a provider is set) made by an engine the household has. */
export function supportedBaseIds(): BaseId[] {
  const have = provider ? provider() : null;
  return ROWS.filter((r) => r.installable && (have === null || have.has(r.id))).map((r) => r.id);
}
export const isSupportedBase = (id: string): id is BaseId => (supportedBaseIds() as string[]).includes(id);

/** Every base the text names, in table order (a name, a version name, a description or a Hugging Face base tag). */
export function basesNamedIn(text: string, only?: readonly string[]): BaseId[] {
  const t = text.toLowerCase();
  return ROWS.filter((r) => (!only || only.includes(r.id)) && r.patterns.some((p) => p.test(t))).map((r) => r.id);
}

/** The base a text names (the first in table order), or "unknown". */
export const baseFromText = (text: string): BaseId | "unknown" => basesNamedIn(text)[0] ?? "unknown";

/** What a Civitai base label means: a concrete base, a generic family label (version to be read from text), or neither. */
export function civitaiLabel(label: string): { kind: "base"; id: BaseId } | { kind: "generic"; candidates: BaseId[] } | { kind: "other" } {
  const row = ROWS.find((r) => (r.labels as readonly string[]).includes(label));
  if (row) return { kind: "base", id: row.id };
  const fam = BASE_FAMILIES.find((f) => (f.genericLabels as readonly string[]).includes(label));
  return fam ? { kind: "generic", candidates: fam.bases.map((b) => b.id) } : { kind: "other" };
}

/** The Civitai `baseModels` strings to ask for: for "default" every supported base and its family's generic labels; for one browse base, that base and its family's generic labels. */
export function civitaiLabelsFor(browse: "default" | "all" | BrowseBase): string[] {
  if (browse === "all") return [];
  const ids = browse === "default" ? supportedBaseIds() : ROWS.filter((r) => r.browse === browse).map((r) => r.id);
  const labels: string[] = [];
  for (const f of BASE_FAMILIES) {
    const mine = f.bases.filter((b) => (ids as string[]).includes(b.id));
    if (!mine.length) continue;
    for (const b of mine) labels.push(...b.labels);
    labels.push(...f.genericLabels);
  }
  return labels;
}

/** The concrete bases a search of this kind wants (for "all", every one). */
export function wantedBaseIds(browse: "default" | "all" | BrowseBase): BaseId[] {
  if (browse === "all") return [...ALL_BASE_IDS];
  if (browse === "default") return supportedBaseIds();
  return ROWS.filter((r) => r.browse === browse).map((r) => r.id);
}

/** The base a browse value names, e.g. "wan" is Wan's id. */
export const baseOfBrowse = (browse: BrowseBase): BaseId => ROWS.find((r) => r.browse === browse)!.id;

/** Plain words for a base id ("an unknown base" for anything else). */
export const baseWords = (id: string): string => rowOf(id)?.words ?? "an unknown base";
export const baseShort = (id: string): string => rowOf(id)?.short ?? "an unknown base";
/** The family names the household can install for, as "LTX" or "LTX or Wan". Used in the not-supported sentence. */
export function supportedFamilyWords(): string {
  const names = BASE_FAMILIES.filter((f) => f.bases.some((b) => isSupportedBase(b.id))).map((f) => f.name);
  return names.length ? names.join(" or ") : "no video model";
}
