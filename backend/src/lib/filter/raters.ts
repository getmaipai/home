import { ContentRating, levelFromLabel, type ContentRater, type RatingLevel, type RatingReason, type RatedContentKind } from "@maipai/spec/ratings/ts/contentRating";
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { foldForSafety } from "@maipai/spec/safety/ts/fold.js";
import { evaluateSafety, forOutput } from "@/lib/safety";
import { codingFloor } from "@/lib/codeSafety";
import { ceilingOf, type Audience } from "./ceiling";
import type { AgeBand } from "@/lib/audience";
import type { ImageCheck as HomeImageCheck, CheckedKind } from "@/lib/pictures/ageCheck";
import type { ChildSafetyCheck as HomeChildSafetyCheck } from "@/lib/pictures/laneGate";

export type Surface = "reply" | "search" | "news" | "library" | "picture" | "clip" | "song" | "coding";
/** `whole`: the reply or article so far, read once more as a whole (the floor's cross-sentence check); its sentences already met `rules-check` one by one. */
export type TextInput = { kind: "text"; text: string; field: "prompt" | "lyrics" | "title" | "transcript"; lane?: "child" | "teen" | "adult"; point: "request" | "release"; surface: Surface; whole?: true };
export type ExplicitInput = { kind: "explicit"; explicit: boolean };
/** `checked`: whether the finished item is a picture (default) or a clip's frames; it only changes the words of the line a withheld item gets (CONTENT-POLICY-03). */
export type PictureCheckInput = { kind: "picture_check"; checks: ImageCheck[]; childChecks?: ChildSafetyCheck[]; adultOnly: boolean; viewer: Viewer; checked?: "picture" | "video" };
/** SEARCH-RATING-02: a search row as it is built (title, snippet, address) and a fetched page (its extracted text and, where the fetch has it in hand, the start of
 * its HTML), with the engine mode the search ran with. `viewerId` is the person whose own host lists and overrides apply (the block viewer). */
export type SearchMode = "strict" | "moderate" | "off";
export type SearchRowInput = { kind: "search_row"; title: string; snippet?: string | null; url?: string | null; mode: SearchMode; viewerId?: string | null };
export type PageTextInput = { kind: "page_text"; title: string; text: string; url?: string | null; html?: string | null; mode: SearchMode; viewerId?: string | null };
export type RaterInput = TextInput | ExplicitInput | PictureCheckInput | SearchRowInput | PageTextInput;
/** CONTENT-POLICY-02: `detail` is what the rater's own check returned (the floor's `SafetyResult`), carried to the caller on the verdict.
 * `pass` is "this rater ran and found nothing to hold": the door keeps its detail and goes on to the next rater. */
export type RaterVerdict = { level: RatingLevel; reasons?: RatingReason[]; withhold?: true; detail?: unknown; source?: ContentRater["source"] } | { pass: true; detail?: unknown } | null;
export interface Rater extends ContentRater { rate(input: RaterInput, audience: Audience): RaterVerdict }

export type AgeLabel = "adult" | "possibly_minor" | "child" | "none";
export type ImageCheck = HomeImageCheck;
export type ChildSafetyCheck = HomeChildSafetyCheck;
export type Viewer = "adult" | "teen" | "child";

const metadata = (id: string, priority: number, rates: RatedContentKind[], source: ContentRater["source"]): ContentRater => ({ id, version: 1, rates, priority, source, reaches_internet: false });

type MinorModules = {
  pictures: typeof import("@/lib/pictures/policy"); lane: typeof import("@/lib/pictures/lane");
  laneGate: typeof import("@/lib/pictures/laneGate"); music: typeof import("@/lib/music/policy");
  content: typeof import("@/lib/contentPolicy"); videos: typeof import("@/lib/videos/policy");
};
type AgeModule = typeof import("@/lib/pictures/ageCheck");
let minorModules: MinorModules | undefined;
let ageModule: AgeModule | undefined;
/** The door primes only the lazy modules needed by the selected path before invoking these synchronous raters. */
export async function prepareRaters(options: { minor?: boolean; pictureCheck?: boolean }): Promise<void> {
  if (options.minor && !minorModules) {
    const [pictures, lane, laneGate, music, content, videos] = await Promise.all([
      import("@/lib/pictures/policy"), import("@/lib/pictures/lane"), import("@/lib/pictures/laneGate"),
      import("@/lib/music/policy"), import("@/lib/contentPolicy"), import("@/lib/videos/policy"),
    ]);
    minorModules = { pictures, lane, laneGate, music, content, videos };
  }
  if (options.pictureCheck && !ageModule) ageModule = await import("@/lib/pictures/ageCheck");
}

/** The synchronous twin of `prepareRaters({ minor: true })`, for a caller that cannot await (the stream gate, the news gate): the modules are
 * loaded once by a lazy `require` (they are cached by the runtime after the first load, the same way pass.ts reaches settings). */
export function prepareMinorRatersSync(): void {
  if (minorModules) return;
  minorModules = {
    pictures: require("@/lib/pictures/policy"), lane: require("@/lib/pictures/lane"), laneGate: require("@/lib/pictures/laneGate"),
    music: require("@/lib/music/policy"), content: require("@/lib/contentPolicy"), videos: require("@/lib/videos/policy"),
  };
}
export function minorRatersReady(): boolean { return !!minorModules; }

function refusal(result: { action: string; categories: readonly string[] }, detail?: unknown): RaterVerdict {
  if (result.action !== "refuse") return null;
  if (result.categories.includes("csam") || result.categories.includes("grooming")) return { level: "Prohibited", reasons: ["minor_line"], ...(detail ? { detail } : {}) };
  return { level: "Unrated", withhold: true, ...(detail ? { detail } : {}) };
}

const minorLine: Rater = {
  ...metadata("minor-line", 1, ["reply", "picture", "clip", "song", "article", "web_page"], "worked_out"),
  rate(input, audience) {
    try {
      const band = audience.band as AgeBand;
      if (input.kind === "picture_check") {
        if (!ageModule) throw new Error("picture check module not prepared");
        const age = ageModule;
        const decision = input.viewer === "child" || input.viewer === "teen"
          ? (minorModules ?? (() => { throw new Error("minor picture check module not prepared"); })()).laneGate.decideForLane({ lane: input.viewer, checks: input.checks, childChecks: input.childChecks, adultOnly: input.adultOnly, kind: input.checked ?? "picture" })
          : age.decideAgeCheck(input.checks, input.adultOnly, input.checked ?? "picture", input.viewer);
        const possibleMinorSexual = input.checks.some((check) => check.ok && age.showsPossibleMinor(check.verdict) && check.verdict.is_nude_or_sexual);
        // The decision (its line and reason) rides on the verdict as `detail`, so the caller keeps today's line (CONTENT-POLICY-03).
        if (decision.action === "withhold") return possibleMinorSexual
          ? { level: "Prohibited", reasons: ["minor_line"], detail: decision }
          : { level: "Unrated", withhold: true, detail: decision };
        return { level: input.adultOnly ? "X" : input.viewer === "child" ? "G" : input.viewer === "teen" ? "PG-13" : "X", detail: decision };
      }
      if (input.kind !== "text") return null;
      if (input.surface === "reply") {
        const result = evaluateSafety(input.text, band, input.point === "request" ? "message" : "reply");
        const checked = input.point === "release" ? forOutput(result) : result;
        // A released reply still carries its result: an allow_with_resources (crisis) answer is not a hold, and the caller needs the signal.
        return refusal(checked, checked) ?? { pass: true, detail: checked };
      }
      if (input.surface === "news" && input.point === "release") {
        // News text for a minor meets the same floor a spoken reply does (news/childGate.ts), and a headline the minor floor (newsMinorFloor.ts).
        if (input.field === "title") {
          const result = checkSafety(input.text, { isMinor: true });
          return result.flagged ? { level: "Unrated", withhold: true, detail: result } : { pass: true, detail: result };
        }
        const result = forOutput(evaluateSafety(input.text, band, "reply"));
        return refusal(result, result) ?? { pass: true, detail: result };
      }
      if (input.surface === "coding") {
        const result = codingFloor(input.text, band, input.point === "request" ? "in" : "out");
        return refusal(result.result);
      }
      if (input.point !== "request") return null;
      if (detectCsam(input.text).matched.length > 0) return { level: "Prohibited", reasons: ["minor_line"] };
      if (band !== "adult") {
        const { pictures, music } = minorModules ?? (() => { throw new Error("minor modules not prepared"); })();
        if (pictures.promptViolatesMinorLine(input.text, input.lane) || (input.surface === "song" && music.refuseMusicPrompt(input.text) === "minor_sexual")) {
          return { level: "Prohibited", reasons: ["minor_line"] };
        }
      }
      return null;
    } catch {
      return { level: "Prohibited", reasons: ["minor_line"] };
    }
  },
};

const lanePrompt: Rater = {
  ...metadata("lane-prompt", 2, ["picture", "clip", "song"], "worked_out"),
  rate(input, audience) {
    if (input.kind !== "text" || audience.band === "adult" || input.point !== "request") return null;
    try {
      const { pictures, videos } = minorModules ?? (() => { throw new Error("minor modules not prepared"); })();
      const lane = input.lane ?? audience.band;
      // The refusal code rides on the verdict as `detail`, so a caller keeps today's typed refusal (CONTENT-POLICY-03).
      const result: string | null = pictures.refusePrompt(input.text, { lane });
      if (result === "minor_sexual") return { level: "Prohibited", reasons: ["minor_line"], detail: result };
      if (result === "child_content" || result === "teen_content") return { level: "R", detail: result };
      if (input.surface === "clip") {
        const videoResult = videos.refuseVideoPrompt(input.text, { lane });
        if (videoResult === "minor_sexual") return { level: "Prohibited", reasons: ["minor_line"], detail: videoResult };
        if (videoResult) return { level: "R", detail: videoResult };
      }
      return null;
    } catch { return null; }
  },
};

const explicitFlag: Rater = {
  ...metadata("explicit-flag", 3, ["song", "podcast"], "given"),
  rate(input) {
    if (input.kind !== "explicit") return null;
    const level = levelFromLabel("explicit", input.explicit);
    return level ? { level } : null;
  },
};

const rulesCheck: Rater = {
  ...metadata("rules-check", 4, ["reply", "article", "web_page", "song", "picture", "clip"], "worked_out"),
  rate(input, audience) {
    // A flag that is not set is no label: the rules check reads text, so an unflagged item is Unrated here (C4), never G.
    if (input.kind !== "text") return null;
    try {
      const { content } = minorModules ?? (() => { throw new Error("minor modules not prepared"); })();
      const result = content.contentPolicyFor({ actor: audience.actor, band: audience.band, surface: "chat", surfaceClass: "written", spoken: false }).check(input.text, input.field);
      if (!result) return { level: "G" };
      const level: RatingLevel = result.kind === "minor_line" ? "Prohibited" : result.kind === "sexual" ? "X" : "R";
      return { level, reasons: [result.kind] };
    } catch { return null; }
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// SEARCH-RATING-02 (docs/design/search-rating-2026-11-17.md): a search row and a fetched page are rated as they are built, by the cheapest signals
// and never by a model: the host lists, the page's own adult label, the standing minor floor, the content policy on the words, then the engine
// mode as the declared fallback. Both raters rate `web_page` only, and each catches its own throw as a withhold (B): a check that threw never
// falls through to the unrated allowance. The stamp's `source` is the layer that gave the level: `given` (a list or a label), `worked_out`
// (the words), `declared` (the engine mode). The spec's `RatingReason` set has no "adult_site" or "admin_deny", and an Unrated stamp carries
// no reasons, so a list verdict carries none.
// ---------------------------------------------------------------------------------------------------------------------------------------
const WITHHOLD: RaterVerdict = { level: "Unrated", withhold: true };
const MODE_LEVEL: Record<SearchMode, RatingLevel> = { strict: "G", moderate: "PG-13", off: "Unrated" };
const LEVEL_RANK: Record<string, number> = { G: 0, PG: 1, "PG-13": 2, R: 3, X: 4 };
const hostListsModule = () => require("@/lib/blocklists/hostLists") as typeof import("@/lib/blocklists/hostLists");
const listPolicyModule = () => require("@/lib/blocklists/policy") as typeof import("@/lib/blocklists/policy");
/** The adult-site list (the locked one for a child and a teen): the one list a host may be on and still be a rating (X) rather than a withhold. */
function adultSiteListIds(): Set<string> {
  return new Set(listPolicyModule().BLOCKLIST_POLICY.lists.filter((row) => row.category === "adult").map((row) => row.id));
}
const AGE_LABEL_VALUES = new Set(["adult", "mature", "rta-5042-1996-1400-1577-rta"]);
const HTML_HEAD_BYTES = 64 * 1024;
/** The page's own adult label (design section 2): `<meta name="rating" content="adult|mature|RTA-5042-1996-1400-1577-RTA">`, name and content
 * case-insensitive, in the first 64 KB of the HTML. This also covers the RTA label, which is published in that tag. */
export function pageCarriesAdultLabel(html: string | null | undefined): boolean {
  if (!html) return false;
  for (const tag of html.slice(0, HTML_HEAD_BYTES).matchAll(/<meta\b[^>]*>/gi)) {
    let name: string | null = null;
    let content: string | null = null;
    for (const attr of tag[0].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      const key = attr[1]!.toLowerCase();
      const value = (attr[2] ?? attr[3] ?? attr[4] ?? "").trim().toLowerCase();
      if (key === "name") name = value;
      else if (key === "content") content = value;
    }
    if (name === "rating" && content !== null && AGE_LABEL_VALUES.has(content)) return true;
  }
  return false;
}

type Found = { level: RatingLevel; source: ContentRater["source"]; reasons?: RatingReason[] };
/** The shared body of both search raters. Steps run in this order and ALL of them run for every row (K, C6): only a Prohibited result or a
 * withhold ends it early; otherwise the strictest level found stands. */
function rateSearch(input: SearchRowInput | PageTextInput, audience: Audience, modules: { content: { checkAll(text: string): Array<{ kind: string; severity: "mild" | "strong" }> } }): RaterVerdict {
  const band = audience.band as AgeBand;
  const personId = input.viewerId ?? undefined;
  const lists = hostListsModule();
  let best: Found | null = null;
  const note = (found: Found): void => {
    const rank = LEVEL_RANK[found.level] ?? -1;
    if (best === null || rank > (LEVEL_RANK[best.level] ?? -1)) best = found;
  };
  // 1. The host lists (a host rule is applied to everyone and never lifted; every matching list is read, not only the first).
  const hits = lists.hostHits(band, input.url, personId);
  if (hits.deny) { lists.bumpListDrop(lists.CUSTOM_DENY, band); return WITHHOLD; }
  if (hits.notReady) { lists.bumpListDrop(lists.LISTS_NOT_READY, band); return WITHHOLD; }
  if (hits.unreadable) { lists.bumpListDrop("unreadable-address", band); return WITHHOLD; }
  if (hits.lists.length > 0) {
    const adult = adultSiteListIds();
    const others = hits.lists.filter((id) => !adult.has(id));
    if (others.length > 0) { lists.bumpListDrop(others[0]!, band); return WITHHOLD; }
    // The adult-site list alone is a rating: a ceiling of X releases it (chat rule 0, the admin's rating override).
    if (ceilingOf(audience, "search") < 4) lists.bumpListDrop(hits.lists[0]!, band);
    note({ level: "X", source: "given" });
  }
  // The page's own adult label (a page only).
  if (input.kind === "page_text" && pageCarriesAdultLabel(input.html)) note({ level: "X", source: "given" });
  // 2. The standing floor (the spec's checkSafety with isMinor), whoever is looking.
  const body = input.kind === "page_text" ? input.text : input.snippet ?? "";
  const text = `${input.title}. ${body}`;
  const safety = checkSafety(text, { isMinor: true });
  if (safety.flagged) {
    if (safety.categories.some((category) => category === "csam" || category === "grooming")) return { level: "Prohibited", reasons: ["minor_line"], source: "worked_out" };
    // C6: the injection, jailbreak and private-data catches stand for everyone and no ceiling lifts them.
    if (safety.categories.some((category) => category === "prompt_injection" || category === "jailbreak" || category === "pii_extraction")) return WITHHOLD;
    note({ level: "X", source: "worked_out" });
  }
  // 3. The content policy on the same text with every kind on and every severity read (D, J): the strictest hit stands.
  for (const hit of modules.content.checkAll(text)) {
    if (hit.kind === "minor_line") return { level: "Prohibited", reasons: ["minor_line"], source: "worked_out" };
    if (hit.kind === "sexual") note({ level: "X", source: "worked_out", reasons: ["sexual"] });
    else if (hit.kind === "gore") note({ level: "R", source: "worked_out", reasons: ["gore"] });
    else if (hit.kind === "swearing") note({ level: hit.severity === "strong" ? "R" : "PG-13", source: "worked_out", reasons: ["swearing"] });
    else if (hit.kind === "drugs" || hit.kind === "gambling") note({ level: "PG-13", source: "worked_out", reasons: [hit.kind] });
  }
  const found = best as Found | null;
  if (found) return { level: found.level, source: found.source, ...(found.reasons ? { reasons: found.reasons } : {}) };
  // 4. The fallback: nothing rated it. A row with nothing to read (no title and no snippet, or no letters the folder can read) is Unrated.
  if (!foldForSafety(text).hasLatin) return { level: "Unrated", source: "worked_out" };
  return { level: MODE_LEVEL[input.mode] ?? "Unrated", source: "declared" };
}

function searchRater(id: string, priority: number, kind: SearchRowInput["kind"] | PageTextInput["kind"]): Rater {
  return {
    ...metadata(id, priority, ["web_page"], "worked_out"),
    rate(input, audience) {
      if (input.kind !== kind) return null;
      try {
        const { content } = minorModules ?? (() => { throw new Error("minor modules not prepared"); })();
        return rateSearch(input as SearchRowInput | PageTextInput, audience, { content });
      } catch { return WITHHOLD; }
    },
  };
}
const pageLabel: Rater = searchRater("page-label", 1, "page_text");
const searchRow: Rater = searchRater("search-row", 2, "search_row");

export const RATERS: readonly Rater[] = Object.freeze([minorLine, pageLabel, lanePrompt, searchRow, explicitFlag, rulesCheck]);
const KIND_BY_SURFACE: Record<Surface, RatedContentKind> = { reply: "reply", search: "web_page", news: "article", library: "song", picture: "picture", clip: "clip", song: "song", coding: "coding" as RatedContentKind };
export function ratersFor(kind: RatedContentKind): Rater[] { return RATERS.filter((rater) => rater.rates.includes(kind)); }
export function contentKindForSurface(surface: Surface): RatedContentKind { return KIND_BY_SURFACE[surface]; }
