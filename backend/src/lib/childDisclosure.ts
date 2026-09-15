import lifeEvents from "../../../spec/vocab/life-events.json" with { type: "json" };

type Disclosure = "child_ok" | "adult_only";

const cues = lifeEvents.classes
  .filter((entry) => entry.adult_to_tell)
  .flatMap((entry) => (entry.cues ?? []).map((cue) => cue.toLowerCase()));

function escapedCue(cue: string): string {
  return cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function defaultChildDisclosure(
  text: string,
  opts: { sensitive: boolean; scope: string },
): Disclosure {
  if (opts.sensitive) return "adult_only";
  const lower = text.toLowerCase();
  return cues.some((cue) => new RegExp(`\\b${escapedCue(cue)}\\b`).test(lower))
    ? "adult_only"
    : "child_ok";
}
