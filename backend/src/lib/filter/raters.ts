import { ContentRating, levelFromLabel, type ContentRater, type RatingLevel, type RatingReason, type RatedContentKind } from "@maipai/spec/ratings/ts/contentRating";
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { evaluateSafety, forOutput } from "@/lib/safety";
import { codingFloor } from "@/lib/codeSafety";
import type { Audience } from "./ceiling";
import type { AgeBand } from "@/lib/audience";
import type { ImageCheck as HomeImageCheck, CheckedKind } from "@/lib/pictures/ageCheck";
import type { ChildSafetyCheck as HomeChildSafetyCheck } from "@/lib/pictures/laneGate";

export type Surface = "reply" | "search" | "news" | "library" | "picture" | "clip" | "song" | "coding";
/** `whole`: the reply or article so far, read once more as a whole (the floor's cross-sentence check); its sentences already met `rules-check` one by one. */
export type TextInput = { kind: "text"; text: string; field: "prompt" | "lyrics" | "title" | "transcript"; lane?: "child" | "teen" | "adult"; point: "request" | "release"; surface: Surface; whole?: true };
export type ExplicitInput = { kind: "explicit"; explicit: boolean };
export type PictureCheckInput = { kind: "picture_check"; checks: ImageCheck[]; childChecks?: ChildSafetyCheck[]; adultOnly: boolean; viewer: Viewer };
export type RaterInput = TextInput | ExplicitInput | PictureCheckInput;
/** CONTENT-POLICY-02: `detail` is what the rater's own check returned (the floor's `SafetyResult`), carried to the caller on the verdict.
 * `pass` is "this rater ran and found nothing to hold": the door keeps its detail and goes on to the next rater. */
export type RaterVerdict = { level: RatingLevel; reasons?: RatingReason[]; withhold?: true; detail?: unknown } | { pass: true; detail?: unknown } | null;
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
          ? (minorModules ?? (() => { throw new Error("minor picture check module not prepared"); })()).laneGate.decideForLane({ lane: input.viewer, checks: input.checks, childChecks: input.childChecks, adultOnly: input.adultOnly, kind: "picture" })
          : age.decideAgeCheck(input.checks, input.adultOnly, "picture", input.viewer);
        const possibleMinorSexual = input.checks.some((check) => check.ok && age.showsPossibleMinor(check.verdict) && check.verdict.is_nude_or_sexual);
        if (decision.action === "withhold") return possibleMinorSexual
          ? { level: "Prohibited", reasons: ["minor_line"] }
          : { level: "Unrated", withhold: true };
        return { level: input.adultOnly ? "X" : input.viewer === "child" ? "G" : input.viewer === "teen" ? "PG-13" : "X" };
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
      const result: string | null = pictures.refusePrompt(input.text, { lane });
      if (result === "minor_sexual") return { level: "Prohibited", reasons: ["minor_line"] };
      if (result === "child_content" || result === "teen_content") return { level: "R" };
      if (input.surface === "clip") {
        const videoResult = videos.refuseVideoPrompt(input.text, { lane });
        if (videoResult === "minor_sexual") return { level: "Prohibited", reasons: ["minor_line"] };
        if (videoResult) return { level: "R" };
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

export const RATERS: readonly Rater[] = Object.freeze([minorLine, lanePrompt, explicitFlag, rulesCheck]);
const KIND_BY_SURFACE: Record<Surface, RatedContentKind> = { reply: "reply", search: "web_page", news: "article", library: "song", picture: "picture", clip: "clip", song: "song", coding: "coding" as RatedContentKind };
export function ratersFor(kind: RatedContentKind): Rater[] { return RATERS.filter((rater) => rater.rates.includes(kind)); }
export function contentKindForSurface(surface: Surface): RatedContentKind { return KIND_BY_SURFACE[surface]; }
