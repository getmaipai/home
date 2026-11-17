/**
 * FILTER-DOOR-01 fronts today's checks under rules C1, C2, C4, C5 and C6.
 * No caller uses this door yet; surface rows move callers after equivalence is proven.
 */
import { ContentRating, overCeiling, type RatingLevel, type RatedContentKind } from "@maipai/spec/ratings/ts/contentRating";
import { ceilingOf, kindOf, type Audience } from "./ceiling";
import { passForSurface } from "./pass";
import { stampAllowed } from "./stampCompare";
import { RATERS, contentKindForSurface, prepareRaters, type Rater, type RaterInput, type RaterVerdict, type Surface } from "./raters";

export type { Surface, RaterInput } from "./raters";
export type { Audience } from "./ceiling";
export type DoorVerdict = { verdict: "held" | "released"; rating: ContentRating | null; held_by?: string };
export type Door = {
  checkRequest(input: { surface: Surface; audience: Audience; request: RaterInput & { kind: "text" } }): Promise<DoorVerdict>;
  release(input: { surface: Surface; audience: Audience; item: RaterInput }): Promise<DoorVerdict>;
  filterList<T>(input: { surface: Surface; audience: Audience; rows: T[]; rate: (row: T) => RaterInput | ContentRating | null }): Promise<T[]>;
};

const loaded = new Set<string>();
async function ensureFor(input: RaterInput): Promise<void> {
  if (input.kind === "picture_check") {
    if (!loaded.has("@/lib/pictures/ageCheck")) {
      await prepareRaters({ pictureCheck: true });
      loaded.add("@/lib/pictures/ageCheck");
    }
  }
}
async function loadMinorModules(): Promise<void> {
  if (loaded.has("@/lib/contentPolicy")) return;
  await Promise.all([
    import("@/lib/contentPolicy"), import("@/lib/pictures/policy"), import("@/lib/pictures/lane"),
    import("@/lib/pictures/laneGate"), import("@/lib/music/policy"), import("@/lib/pictures/ageCheck"), import("@/lib/videos/policy"),
  ]);
  await prepareRaters({ minor: true, pictureCheck: true });
  for (const name of ["@/lib/contentPolicy", "@/lib/pictures/policy", "@/lib/pictures/lane", "@/lib/pictures/laneGate", "@/lib/music/policy", "@/lib/pictures/ageCheck", "@/lib/videos/policy"]) loaded.add(name);
}
export function loadedModules(): string[] { return [...loaded]; }
export function __resetForTests(): void { loaded.clear(); }

function makeStamp(rater: Rater, verdict: Exclude<RaterVerdict, null>, label?: { system: string; value: string }): ContentRating {
  return ContentRating.parse({
    level: verdict.level, source: rater.source, rater: rater.id, rater_version: rater.version,
    rated_at: new Date().toISOString(), ...(verdict.reasons ? { reasons: verdict.reasons } : {}), ...(label ? { label } : {}),
  });
}
function unratedStamp(raterId = "filter-unrated", source: "worked_out" | "declared" = "worked_out"): ContentRating {
  return ContentRating.parse({ level: "Unrated", source, rater: raterId, rater_version: 1, rated_at: new Date().toISOString() });
}
const labelFor = (item: RaterInput) => item.kind === "explicit" ? { system: "explicit", value: String(item.explicit) } : undefined;

export function buildDoor(options: { raters?: Rater[]; onRate?: (raterId: string, surface: Surface) => void } = {}): Door {
  const raters = options.raters ?? [...RATERS];
  async function evaluate(surface: Surface, audience: Audience, item: RaterInput): Promise<DoorVerdict> {
    const ceiling = ceilingOf(audience, surface);
    const unratedOk = passForSurface(audience).unrated.has(kindOf(surface)); // OVERRIDES-01 (C4, C9): an admin allowed unrated here
    const kind: RatedContentKind = surface === "coding" ? "reply" : contentKindForSurface(surface);
    const adultPath = ceiling === 4;
    const adultAllowed = surface === "reply" || surface === "picture" || surface === "clip" || surface === "song" || surface === "coding";
    if (adultPath && !adultAllowed) return { verdict: "released", rating: null };
    if (adultPath && item.kind === "explicit") return { verdict: "released", rating: null };
    if (ceiling < 4) await loadMinorModules();
    await ensureFor(item);
    const selected = adultPath
      ? raters.filter((r) => r.id === "minor-line")
      : raters.filter((r) => r.rates.includes(kind)).sort((a, b) => a.priority - b.priority);
    let last: Rater | undefined;
    for (const rater of selected) {
      options.onRate?.(rater.id, surface);
      last = rater;
      try {
        const result = await rater.rate(item, audience);
        if (!result) continue;
        const rating = makeStamp(rater, result, rater.source === "given" ? labelFor(item) : undefined);
        // C9: an allowed Unrated covers only a verdict a rater ran and gave without a withhold; a withhold and Prohibited are never released.
        const unratedReleased = result.level === "Unrated" && !result.withhold && unratedOk;
        if (result.withhold || (overCeiling(result.level, ceiling) && !unratedReleased)) return { verdict: "held", rating, held_by: rater.id };
        // Prohibited is terminal even if a custom ceiling or downstream rater says otherwise.
        if (result.level === "Prohibited") return { verdict: "held", rating, held_by: rater.id };
        return { verdict: "released", rating };
      } catch {
        if (rater.id === "minor-line") {
          const rating = makeStamp(rater, { level: "Prohibited", reasons: ["minor_line"] });
          return { verdict: "held", rating, held_by: rater.id };
        }
      }
    }
    const rating = unratedStamp(last?.id);
    // Every rater that ran could not rate it: Unrated, released only when an override allows unrated for this kind (a rater did run).
    const heldUnrated = overCeiling("Unrated", ceiling) && !(last && unratedOk);
    return { verdict: heldUnrated ? "held" : "released", rating, ...(heldUnrated ? { held_by: last?.id ?? "unrated" } : {}) };
  }

  return {
    checkRequest: ({ surface, audience, request }) => evaluate(surface, audience, request),
    release: ({ surface, audience, item }) => evaluate(surface, audience, item),
    async filterList<T>({ surface, audience, rows, rate }: { surface: Surface; audience: Audience; rows: T[]; rate: (row: T) => RaterInput | ContentRating | null }): Promise<T[]> {
      const ceiling = ceilingOf(audience, surface);
      if (ceiling === 4) return rows;
      const unratedOk = passForSurface(audience).unrated.has(kindOf(surface));
      await loadMinorModules();
      const kept: T[] = [];
      for (const row of rows) {
        let value: RaterInput | ContentRating | null;
        try { value = rate(row); } catch { value = null; }
        if (value instanceof Object && "level" in value && "source" in value) {
          // RATE-INGEST-01: the one stamp comparison, shared with the stored-rating list filter (stampCompare.ts); an invalid stamp is Unrated.
          if (stampAllowed(value, ceiling, unratedOk)) kept.push(row);
          continue;
        }
        if (!value) continue;
        const result = await evaluate(surface, audience, value as RaterInput);
        if (result.verdict === "released") kept.push(row);
      }
      return kept;
    },
  };
}

const moduleDoor = buildDoor({});
export const checkRequest = moduleDoor.checkRequest;
export const release = moduleDoor.release;
export const filterList = moduleDoor.filterList;
