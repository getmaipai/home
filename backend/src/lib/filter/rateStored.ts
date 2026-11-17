/**
 * RATE-INGEST-01 (RULES.md C9): the viewer-independent rating of one stored item, run when it arrives or by the ratings sweep, never
 * while a person waits for a list. It calls today's checks exactly (the library floor, the shelf floor, the content policy for a teen and
 * a child, the file's audience mark) and maps their verdicts to one level, so a child (ceiling 0) and a teen (ceiling 2) get today's answers.
 * Nothing here calls a model. On an error inside a check it returns null and the caller writes no stamp (the sweep retries); an Unrated
 * stamp means every check ran and none could say.
 */
import { ContentRating, levelFromLabel, type RatingLevel, type RatingReason } from "@maipai/spec/ratings/ts/contentRating";
import { contentPolicyFor } from "@/lib/contentPolicy";
import { trips } from "@/lib/media/band";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import type { PersonRow } from "@/types";
import { STORED_RATER_VERSION } from "./stamps";

export type StoredInput =
  | { kind: "media_item"; explicit: boolean; title: string; description?: string | null; also?: ReadonlyArray<string | null | undefined>; lyrics?: string | null; bandOk?: "child" | "teen" | "adult" | null }
  | { kind: "shelf_item"; title: string; text?: string | null; bandOk?: "child" | "teen" | "adult" | null }
  | { kind: "attachment" | "creation"; audience: "all-ages" | "adult-only" | null; provenance?: string };

let hook: ((input: StoredInput) => void) | null = null;
/** Test support: called at the start of every `rateStoredItem` (a counting spy, or a function that throws to simulate a failing check). */
export function __setRateHookForTests(fn: ((input: StoredInput) => void) | null): void { hook = fn; }

const TEEN = { id: "rater-teen", role: "teen" } as PersonRow;
const CHILD = { id: "rater-child", role: "child" } as PersonRow;

function make(level: RatingLevel, rater: string, source: "given" | "worked_out", extra: { reasons?: RatingReason[]; label?: { system: string; value: string } } = {}): ContentRating {
  return ContentRating.parse({ level, source, rater, rater_version: STORED_RATER_VERSION, rated_at: new Date().toISOString(), ...(level === "Unrated" || !extra.reasons ? {} : { reasons: extra.reasons }), ...(extra.label ? { label: extra.label } : {}) });
}
const RANK: Record<string, number> = { G: 0, PG: 1, "PG-13": 2, R: 3, X: 4 };

function floorText(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(". ");
}

function rateMedia(input: Extract<StoredInput, { kind: "media_item" }>): ContentRating {
  let rating: ContentRating;
  const explicit = levelFromLabel("explicit", true);
  if (input.explicit && explicit) {
    rating = make(explicit, "explicit-flag", "given", { label: { system: "explicit", value: "true" } });
  } else {
    const text = floorText([input.title, ...(input.also ?? []), input.description, input.lyrics]);
    if (trips(text)) rating = make("X", "minor-floor", "worked_out", { reasons: ["sexual"] });
    else {
      const teen = contentPolicyFor(TEEN).check(text, "title");
      if (teen) rating = make(teen.kind === "minor_line" ? "Prohibited" : teen.kind === "sexual" ? "X" : "R", "rules-check", "worked_out", { reasons: [teen.kind] });
      else {
        const child = contentPolicyFor(CHILD).check(text, "title");
        rating = child ? make("PG-13", "rules-check", "worked_out", { reasons: [child.kind] }) : make("G", "rules-check", "worked_out");
      }
    }
  }
  // The row's own `band_ok` stays binding (an adult-only made song, or a mark an adult set): the stamp is never lower than it (an R from the explicit flag stays R, with its label).
  const floor: RatingLevel | null = input.bandOk === "adult" ? "X" : input.bandOk === "teen" ? "PG-13" : null;
  if (floor && rating.level !== "Prohibited" && rating.level !== "Unrated" && RANK[rating.level]! < Math.min(RANK[floor]!, 3)) rating = make(floor, "band-ok", "worked_out", { reasons: rating.reasons });
  return rating;
}

/** The rating of one stored item, or null when a check failed (write no stamp; the sweep retries). */
export function rateStoredItem(input: StoredInput): ContentRating | null {
  try {
    hook?.(input);
    if (input.kind === "media_item") return rateMedia(input);
    if (input.kind === "shelf_item") {
      const text = input.text ? `${input.title}. ${input.text}` : input.title;
      return tripsMinorFloor(text) || input.bandOk === "adult" ? make("X", "minor-floor", "worked_out", { reasons: ["sexual"] }) : make("G", "minor-floor", "worked_out");
    }
    if (input.audience === null) return make("Unrated", "audience-mark", "worked_out");
    const level = levelFromLabel("audience", input.audience);
    return level ? make(level, "audience-mark", "given", { label: { system: "audience", value: input.audience } }) : null;
  } catch {
    return null;
  }
}
