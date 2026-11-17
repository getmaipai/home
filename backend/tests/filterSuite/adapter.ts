import { evaluateSafety, forOutput, evaluateReply, carriesCrisisSignal } from "@/lib/safety";
import { gateGrainFor } from "@/lib/turnMachine/nodes/outputGate";
import { tripsMinorFloor, releaseToBand } from "@/lib/retrieval/minorFloor";
import { minorRowTrips, minorRowAllowed } from "@/lib/retrieval/minorRowFloor";
import { minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { urlAllowedFor, checkHost } from "@/lib/blocklists/hostLists";
import { resolveSafeSearchLevel, safeSearchDefaultFor } from "@/lib/safeSearch";
import { floorSearchResult } from "@/lib/packageHost";
import { gateFor } from "@/lib/news/childGate";
import { bandOkAllowedFor, feedVisibleTo, audienceOf } from "@/lib/shelf/shelfPolicy";
import { applyNewsMinorFloor } from "@/lib/newsMinorFloor";
import { bandOkAtIngest, bandAllows, trips } from "@/lib/media/band";
import { canReadFileAudience, fileAudience } from "@/lib/access";
import { lockState } from "@/lib/adultLock";
import { laneOf, childPromptUnsafe, teenPromptUnsafe } from "@/lib/pictures/lane";
import { pictureDenial, refusePrompt, promptViolatesMinorLine } from "@/lib/pictures/policy";
import { minorSexualMatch, mixedScriptMinorCue } from "@/lib/pictures/minorLine";
import { decideAgeCheck } from "@/lib/pictures/ageCheck";
import { videoDenial, videoAdapterAudiencesFor, stackAudienceFor, refuseVideoPrompt } from "@/lib/videos/policy";
import { checkVideoPrompt } from "@/lib/videos/promptCheck";
import { musicViewDenial, musicDenial, refuseMusicPrompt } from "@/lib/music/policy";
import { contentPolicyFor } from "@/lib/contentPolicy";
import { codingFloor } from "@/lib/codeSafety";
import type { PersonRow } from "@/types";
import { people } from "@/db/schema";

// Inventory: these are the direct pure gates called from the current reply, outputGate, search,
// news, library, picture, video, music, contentPolicy and codeSafety callers. Each branch below
// preserves the callee's argument order; no production policy is reproduced here.
export const TODAY_CHECKS = Object.freeze({
  evaluateSafety, forOutput, evaluateReply, carriesCrisisSignal, gateGrainFor,
  tripsMinorFloor, releaseToBand, minorRowTrips, minorRowAllowed, minorQueryHit,
  urlAllowedFor, checkHost, resolveSafeSearchLevel, safeSearchDefaultFor, floorSearchResult,
  gateFor, bandOkAllowedFor, feedVisibleTo, audienceOf, applyNewsMinorFloor,
  bandOkAtIngest, bandAllows, trips, canReadFileAudience, fileAudience, lockState,
  laneOf, childPromptUnsafe, teenPromptUnsafe, pictureDenial, refusePrompt,
  promptViolatesMinorLine, minorSexualMatch, mixedScriptMinorCue, decideAgeCheck,
  videoDenial, videoAdapterAudiencesFor, stackAudienceFor, refuseVideoPrompt, checkVideoPrompt,
  musicViewDenial, musicDenial, refuseMusicPrompt, contentPolicyFor, codingFloor,
});

type Key = keyof typeof TODAY_CHECKS;
type AnyFn = (...args: any[]) => any;
type CheckMap = Record<Key, AnyFn>;

const ALLOW: Record<Key, AnyFn> = Object.fromEntries(Object.keys(TODAY_CHECKS).map((key) => [key, () => null])) as CheckMap;
Object.assign(ALLOW, {
  evaluateSafety: () => ({ flagged: false, categories: [], matched_signals: [], action: "allow", notify_parent: false }),
  forOutput: (result: any) => ({ ...result, action: "allow" }),
  evaluateReply: () => ({ text: { flagged: false, categories: [], action: "allow" }, effective: { flagged: false, categories: [], action: "allow" } }),
  carriesCrisisSignal: () => false, gateGrainFor: (_band: string, _surface: string, spoken: boolean) => spoken ? "sentence" : "arrival",
  tripsMinorFloor: () => false, releaseToBand: (candidates: any[]) => candidates.map((c) => c.row ?? c),
  minorRowTrips: () => false, minorRowAllowed: () => true, minorQueryHit: () => null,
  urlAllowedFor: () => true, checkHost: () => null, resolveSafeSearchLevel: (_stored: unknown, _band: string) => "off",
  safeSearchDefaultFor: () => "off", floorSearchResult: (result: any) => result,
  gateFor: () => ({ passes: () => true, text: (value: string) => value, sawCrisis: () => false }), bandOkAllowedFor: () => ["child", "teen", "adult"],
  feedVisibleTo: () => true, audienceOf: () => ["all-ages", "child", "teen", "adult"], applyNewsMinorFloor: (result: any) => result,
  bandOkAtIngest: () => ({ ok: true, band_ok: true }), bandAllows: () => true, trips: () => false,
  canReadFileAudience: () => true, fileAudience: () => "all-ages", lockState: () => "open",
  laneOf: () => "adult", childPromptUnsafe: () => false, teenPromptUnsafe: () => false,
  pictureDenial: () => null, refusePrompt: () => null, promptViolatesMinorLine: () => false,
  minorSexualMatch: () => false, mixedScriptMinorCue: () => false, decideAgeCheck: () => ({ allowed: true }),
  videoDenial: () => null, videoAdapterAudiencesFor: () => ["all-ages", "adult-only"], stackAudienceFor: () => "adult",
  refuseVideoPrompt: () => null, checkVideoPrompt: () => [], musicViewDenial: () => null,
  musicDenial: () => null, refuseMusicPrompt: () => null, contentPolicyFor: () => ({ check: () => ({ allowed: true }) }),
  codingFloor: () => ({ held: false, allowed: true }),
});
export const PASS_THROUGH: Readonly<CheckMap> = Object.freeze(ALLOW as CheckMap);

export const NOT_PURE: readonly string[] = Object.freeze([]);

export type Surface = "reply" | "spoken" | "search" | "news" | "library" | "picture" | "clip" | "song" | "central" | "coding";
export type Band = "child" | "teen" | "adult";
export type SuiteCase = { id: string; surface: Surface; point: "request" | "release" | "list"; band: Band; input: any; expect: "held" | "released"; from: string };
export function person(role: string, controls?: unknown): PersonRow {
  const row: Record<string, unknown> = { id: `suite-${role}`, role, birthdate: role === "child" ? "2020-01-01" : role === "teen" ? "2011-01-01" : "1990-01-01" };
  if (controls !== undefined && "controls" in people) row.controls = controls;
  return row as PersonRow;
}

function run(checks: CheckMap, c: SuiteCase, actor: PersonRow): any {
  const i = c.input;
  const f = checks[i.check as Key];
  switch (i.check as Key) {
    case "evaluateSafety": return f(i.text, c.band, i.direction);
    case "forOutput": return f(i.result);
    case "evaluateReply": return f({ text: i.text, speech: i.speech }, c.band);
    case "carriesCrisisSignal": return f(i.result);
    case "gateGrainFor": return f(c.band, i.surface ?? "chat", Boolean(i.spoken));
    case "tripsMinorFloor": case "trips": case "childPromptUnsafe": case "teenPromptUnsafe": case "refusePrompt": case "promptViolatesMinorLine": case "minorSexualMatch": case "mixedScriptMinorCue": case "refuseVideoPrompt": case "checkVideoPrompt": case "refuseMusicPrompt": case "minorQueryHit": return f(i.text ?? i.query, ...(i.check === "minorQueryHit" ? [c.band] : i.check === "checkVideoPrompt" ? [i.options ?? {}] : i.check === "refusePrompt" || i.check === "refuseVideoPrompt" ? [{ lane: i.lane ?? "child" }] : []));
    case "minorRowTrips": return f(i.row);
    case "minorRowAllowed": return f(c.band, i.row, i.options);
    case "urlAllowedFor": return f(c.band, i.url, i.personId);
    case "checkHost": return f(c.band, i.url, i.personId);
    case "resolveSafeSearchLevel": return f(i.stored, c.band);
    case "safeSearchDefaultFor": return f(c.band);
    case "floorSearchResult": return f(i.result, c.band, i.options);
    case "releaseToBand": return f(i.candidates, c.band);
    case "gateFor": return f(c.band).passes(i.text ?? "");
    case "bandOkAllowedFor": return f(c.band);
    case "feedVisibleTo": return f(i.feed, c.band, i.ticked);
    case "audienceOf": return f(c.band);
    case "applyNewsMinorFloor": return f(i.result, c.band);
    case "bandOkAtIngest": return f(i.input);
    case "bandAllows": return f(actor, i.item);
    case "canReadFileAudience": return f(actor, i.file);
    case "fileAudience": return f(i.provenance);
    case "lockState": return f(i.item ?? null, actor, i.proof);
    case "laneOf": case "pictureDenial": case "videoDenial": case "videoAdapterAudiencesFor": case "stackAudienceFor": case "musicViewDenial": case "musicDenial": return f(i.audience ?? { actor, band: c.band });
    case "decideAgeCheck": return f(i.checks, Boolean(i.adultOnly), i.kind ?? "image", i.viewer ?? c.band);
    case "contentPolicyFor": return f(actor).check(i.text, i.field ?? "prompt");
    case "codingFloor": return f(i.text, c.band, i.direction ?? "in");
    default: return f(i.value);
  }
}

function held(check: string, value: any, band: Band): boolean {
  switch (check) {
    case "evaluateSafety": case "evaluateReply": return value.effective?.action === "refuse" || value.action === "refuse";
    case "forOutput": return value.action === "refuse";
    case "carriesCrisisSignal": return Boolean(value);
    case "gateGrainFor": return value === "sentence";
    case "tripsMinorFloor": case "minorRowTrips": case "trips": case "childPromptUnsafe": case "teenPromptUnsafe": case "promptViolatesMinorLine": case "minorSexualMatch": case "mixedScriptMinorCue": return Boolean(value);
    case "releaseToBand": return value.length === 0;
    case "minorRowAllowed": case "urlAllowedFor": case "feedVisibleTo": case "bandAllows": case "canReadFileAudience": return !value;
    case "minorQueryHit": case "checkHost": case "pictureDenial": case "refusePrompt": case "videoDenial": case "refuseVideoPrompt": case "checkVideoPrompt": case "musicViewDenial": case "musicDenial": case "refuseMusicPrompt": return value != null && (!Array.isArray(value) || value.length > 0);
    case "resolveSafeSearchLevel": return value !== "off" && band !== "adult";
    case "safeSearchDefaultFor": return value !== "off" && band !== "adult";
    case "floorSearchResult": return (value?.floor_dropped ?? 0) > 0 || value?.rows?.length < 1;
    case "gateFor": return value === false; // CONTENT-POLICY-02: a teen's sentence meets the gate too
    case "bandOkAllowedFor": return band !== "adult" && !value.includes("adult");
    case "audienceOf": return band !== "adult" && !value.includes("adult");
    case "applyNewsMinorFloor": return Array.isArray(value?.data?.headlines) && value.data.headlines.length === 0;
    case "bandOkAtIngest": return value?.band === "adult";
    case "fileAudience": return value === "adult-only" && band !== "adult";
    case "lockState": return value === "hidden";
    case "laneOf": return value !== "adult";
    case "videoAdapterAudiencesFor": return band !== "adult" && (!value.includes("adult-only"));
    case "stackAudienceFor": return band !== "adult" && value === "all-ages";
    case "decideAgeCheck": return value?.action === "withhold";
    case "contentPolicyFor": return Boolean(value?.kind);
    case "codingFloor": return value?.action === "refuse";
    default: return false;
  }
}

export function buildAdapter(checks: CheckMap = TODAY_CHECKS as CheckMap) {
  const evaluate = (c: SuiteCase) => {
    const actor = (c.input.actor ?? person(c.band)) as PersonRow;
    const route = (allowed: readonly Key[]) => {
      if (!allowed.includes(c.input.check as Key)) throw new Error(`${c.input.check} is not a ${c.surface} check`);
      return run(checks, c, actor);
    };
    // reply: safety.ts callers pass text, band and direction to evaluateSafety, a text/speech pair to evaluateReply,
    // and a classifier result to forOutput/carriesCrisisSignal.
    switch (c.surface) {
      case "reply": return route(["evaluateSafety", "forOutput", "evaluateReply", "carriesCrisisSignal", "contentPolicyFor"]);
      // spoken: outputGate calls gateGrainFor(band, surface, spoken) before it releases speech.
      case "spoken": return route(["gateGrainFor"]);
      // search: minorFloor/minorRowFloor, packageHost and safeSearch receive the current band and the candidate/query.
      case "search": return route(["tripsMinorFloor", "releaseToBand", "minorRowTrips", "minorRowAllowed", "minorQueryHit", "urlAllowedFor", "checkHost", "resolveSafeSearchLevel", "safeSearchDefaultFor", "floorSearchResult"]);
      // news: childGate receives a band then calls passes(text); shelfPolicy receives feed and band; newsMinorFloor receives result and band.
      case "news": return route(["gateFor", "bandOkAllowedFor", "feedVisibleTo", "audienceOf", "applyNewsMinorFloor"]);
      // library: media/band receives item text or actor/item, access receives actor/file or provenance, adultLock receives item/actor/proof.
      case "library": return route(["bandOkAtIngest", "bandAllows", "trips", "canReadFileAudience", "fileAudience", "lockState"]);
      // picture: lane/policy/minorLine/ageCheck receive prompt, audience or review result exactly as named in their signatures.
      case "picture": return route(["laneOf", "childPromptUnsafe", "teenPromptUnsafe", "pictureDenial", "refusePrompt", "promptViolatesMinorLine", "minorSexualMatch", "mixedScriptMinorCue", "decideAgeCheck"]);
      // clip: videos/policy receives audience or prompt, while promptCheck receives prompt and options.
      case "clip": return route(["videoDenial", "videoAdapterAudiencesFor", "stackAudienceFor", "refuseVideoPrompt", "checkVideoPrompt"]);
      // song: music/policy receives audience for access checks and prompt text for the absolute minor line.
      case "song": return route(["musicViewDenial", "musicDenial", "refuseMusicPrompt"]);
      // central: contentPolicyFor(subject).check(text, field) uses the shared household topic defaults.
      case "central": return route(["contentPolicyFor"]);
      // coding: codeSafety receives the exact text, band and direction used at the code gateway.
      case "coding": return route(["codingFloor"]);
    }
  };
  return {
    checkRequest(c: SuiteCase): "held" | "released" { return held(c.input.check, evaluate(c), c.band) ? "held" : "released"; },
    release(c: SuiteCase): "held" | "released" { return held(c.input.check, evaluate(c), c.band) ? "held" : "released"; },
    filterList(c: SuiteCase): unknown[] {
      const result = evaluate(c);
      if (Array.isArray(result) && c.input.check === "releaseToBand") return result;
      if (result?.rows && Array.isArray(result.rows)) return result.rows;
      return held(c.input.check, result, c.band) ? [] : (c.input.rows ?? [result]);
    },
    evaluate,
  };
}
