/**
 * FILTER-DOOR-01 fronts today's checks under rules C1, C2, C4, C5 and C6.
 * No caller uses this door yet; surface rows move callers after equivalence is proven.
 */
import { ContentRating, overCeiling, type RatingLevel, type RatedContentKind } from "@maipai/spec/ratings/ts/contentRating";
import { ceilingOf, kindOf, type Audience } from "./ceiling";
import { passForSurface } from "./pass";
import { stampAllowed } from "./stampCompare";
import { RATERS, contentKindForSurface, minorRatersReady, prepareMinorRatersSync, prepareRaters, type Rater, type RaterInput, type RaterVerdict, type Surface } from "./raters";
import { CONTENT_POLICY_CHAT_KEY, CONTENT_POLICY_NEWS_KEY } from "@/settings/contentKeys";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";

export type { Surface, RaterInput } from "./raters";
export type { Audience } from "./ceiling";
/** `safety`: on the reply and news surfaces, the floor's own result for the text (CONTENT-POLICY-02), on a released verdict too, so a
 * crisis signal (`allow_with_resources`) reaches the caller. */
export type DoorVerdict = { verdict: "held" | "released"; rating: ContentRating | null; held_by?: string; safety?: SafetyResult };
export type Door = {
  checkRequest(input: { surface: Surface; audience: Audience; request: RaterInput & { kind: "text" } }): Promise<DoorVerdict>;
  release(input: { surface: Surface; audience: Audience; item: RaterInput }): Promise<DoorVerdict>;
  /** `release` for a caller that cannot await (the stream gate, the news gate). The raters are synchronous; this loads the minor modules
   * with a lazy `require` when they are not loaded yet and fails closed (held) for a viewer below X if that load throws. */
  releaseSync(input: { surface: Surface; audience: Audience; item: RaterInput }): DoorVerdict;
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

function makeStamp(rater: Rater, verdict: Exclude<RaterVerdict, null | { pass: true }>, label?: { system: string; value: string }): ContentRating {
  return ContentRating.parse({
    level: verdict.level, source: rater.source, rater: rater.id, rater_version: rater.version,
    rated_at: new Date().toISOString(), ...(verdict.reasons ? { reasons: verdict.reasons } : {}), ...(label ? { label } : {}),
  });
}
function unratedStamp(raterId = "filter-unrated", source: "worked_out" | "declared" = "worked_out"): ContentRating {
  return ContentRating.parse({ level: "Unrated", source, rater: raterId, rater_version: 1, rated_at: new Date().toISOString() });
}
const labelFor = (item: RaterInput) => item.kind === "explicit" ? { system: "explicit", value: String(item.explicit) } : undefined;

const LEVELS = ["G", "PG", "PG-13", "R", "X"] as const;

/** C6: a rollout flag never disables a floor. It only decides whether `rules-check` runs for this surface and viewer (read from the pass). */
function rulesSkipped(surface: Surface, audience: Audience, item: RaterInput): boolean {
  if (item.kind !== "text" || (surface !== "reply" && surface !== "news")) return false;
  // A chat request is held by the floor only (today's request check); a `whole` read is the cross-sentence floor check over sentences that each met rules-check.
  if ((surface === "reply" && item.point === "request") || item.whole) return true;
  const key = surface === "reply" ? CONTENT_POLICY_CHAT_KEY : CONTENT_POLICY_NEWS_KEY;
  return passForSurface(audience).settings[key] === false;
}

export function buildDoor(options: { raters?: Rater[]; onRate?: (raterId: string, surface: Surface) => void } = {}): Door {
  const raters = options.raters ?? [...RATERS];
  async function evaluate(surface: Surface, audience: Audience, item: RaterInput): Promise<DoorVerdict> {
    const ceiling = ceilingOf(audience, surface);
    const adultPath = ceiling === 4;
    const adultAllowed = surface === "reply" || surface === "picture" || surface === "clip" || surface === "song" || surface === "coding";
    if (adultPath && (!adultAllowed || item.kind === "explicit")) return { verdict: "released", rating: null };
    if (ceiling < 4) await loadMinorModules();
    await ensureFor(item);
    return run(surface, audience, item, ceiling);
  }
  function run(surface: Surface, audience: Audience, item: RaterInput, ceiling: ReturnType<typeof ceilingOf>): DoorVerdict {
    const unratedOk = passForSurface(audience).unrated.has(kindOf(surface)); // OVERRIDES-01 (C4, C9): an admin allowed unrated here
    const kind: RatedContentKind = surface === "coding" ? "reply" : contentKindForSurface(surface);
    const adultPath = ceiling === 4;
    const skipRules = rulesSkipped(surface, audience, item);
    const selected = adultPath
      ? raters.filter((r) => r.id === "minor-line")
      : raters.filter((r) => r.rates.includes(kind) && !(skipRules && r.id === "rules-check")).sort((a, b) => a.priority - b.priority);
    let last: Rater | undefined;
    let passedBy: Rater | undefined;
    let safety: SafetyResult | undefined;
    const carry = (): { safety?: SafetyResult } => (safety ? { safety } : {});
    for (const rater of selected) {
      options.onRate?.(rater.id, surface);
      last = rater;
      try {
        const result = rater.rate(item, audience);
        if (!result) continue;
        // The rater ran and found nothing to hold: its detail is kept and the next rater runs (CONTENT-POLICY-02).
        if ("pass" in result) { passedBy = rater; if (result.detail) safety = result.detail as SafetyResult; continue; }
        if (result.detail) safety = result.detail as SafetyResult;
        const rating = makeStamp(rater, result, rater.source === "given" ? labelFor(item) : undefined);
        // C9: an allowed Unrated covers only a verdict a rater ran and gave without a withhold; a withhold and Prohibited are never released.
        const unratedReleased = result.level === "Unrated" && !result.withhold && unratedOk;
        if (result.withhold || (overCeiling(result.level, ceiling) && !unratedReleased)) return { verdict: "held", rating, held_by: rater.id, ...carry() };
        // Prohibited is terminal even if a custom ceiling or downstream rater says otherwise.
        if (result.level === "Prohibited") return { verdict: "held", rating, held_by: rater.id, ...carry() };
        return { verdict: "released", rating, ...carry() };
      } catch {
        if (rater.id === "minor-line") {
          const rating = makeStamp(rater, { level: "Prohibited", reasons: ["minor_line"] });
          return { verdict: "held", rating, held_by: rater.id };
        }
      }
    }
    // A floor pass with the content rules skipped (a rollout flag off, a request, a whole-text read) is released at the viewer's own
    // ceiling level: it must never fall through to the Unrated hold below (CONTENT-POLICY-02).
    if (passedBy && skipRules && !adultPath) return { verdict: "released", rating: makeStamp(passedBy, { level: LEVELS[ceiling] }), ...carry() };
    const rating = unratedStamp(last?.id);
    // Every rater that ran could not rate it: Unrated, released only when an override allows unrated for this kind (a rater did run).
    const heldUnrated = overCeiling("Unrated", ceiling) && !(last && unratedOk);
    return { verdict: heldUnrated ? "held" : "released", rating, ...(heldUnrated ? { held_by: last?.id ?? "unrated" } : {}), ...carry() };
  }
  function releaseSync(surface: Surface, audience: Audience, item: RaterInput): DoorVerdict {
    const ceiling = ceilingOf(audience, surface);
    const adultAllowed = surface === "reply" || surface === "picture" || surface === "clip" || surface === "song" || surface === "coding";
    if (ceiling === 4 && (!adultAllowed || item.kind === "explicit")) return { verdict: "released", rating: null };
    if (ceiling < 4 && !minorRatersReady()) {
      try { prepareMinorRatersSync(); } catch { return { verdict: "held", rating: unratedStamp("filter-not-ready"), held_by: "filter-not-ready" }; }
    }
    return run(surface, audience, item, ceiling);
  }

  return {
    checkRequest: ({ surface, audience, request }) => evaluate(surface, audience, request),
    release: ({ surface, audience, item }) => evaluate(surface, audience, item),
    releaseSync: ({ surface, audience, item }) => releaseSync(surface, audience, item),
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
export const releaseSync = moduleDoor.releaseSync;
export const filterList = moduleDoor.filterList;
