import presetsFile from "@maipai/spec/ease/presets.json";

// EASE-OF-USE-01c: the pure part of useEase: which value each data-ease-* attribute takes.

type PresetName = keyof typeof presetsFile.presets;
type PresetValues = Record<string, string>;

const PRESETS = presetsFile.presets as Record<string, PresetValues>;
const FALLBACK: PresetName = "standard";

/** The `ease.*` key behind each attribute, and the attribute it sets. */
const ATTRIBUTES = [
  ["text_size", "data-ease-text"],
  ["spacing", "data-ease-spacing"],
  ["targets", "data-ease-targets"],
  ["contrast", "data-ease-contrast"],
  ["motion", "data-ease-motion"],
] as const;

export type EaseAttributes = Record<(typeof ATTRIBUTES)[number][1], string>;

/** Resolves each fine-grained key: a key that says `preset` takes the resolved preset's value. */
export function resolveEaseAttributes(values: Record<string, unknown>): EaseAttributes {
  const presetKey = typeof values["ease.preset"] === "string" && Object.hasOwn(PRESETS, values["ease.preset"]) ? values["ease.preset"] : FALLBACK;
  const preset = PRESETS[presetKey]!;
  const out = {} as EaseAttributes;
  for (const [key, attribute] of ATTRIBUTES) {
    const own = values[`ease.${key}`];
    out[attribute] = typeof own === "string" && own !== "preset" ? own : preset[key]!;
  }
  return out;
}
