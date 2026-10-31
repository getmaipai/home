// PEOPLE-PROMPTS-01 / KIDS-CREATE-01: the finished-picture decision for a teen's or a child's picture, beside ageCheck.ts (which owns the
// adult decision and the apparent-age check and is not changed here). A teen's or a child's picture is shown only when:
//   - the apparent-age check ran and found nothing nude or sexual, whoever is in it (a check that could not run withholds: fail closed);
//   - and, for a child, a second question on the same local vision model says the picture is clearly a friendly cartoon and shows no real
//     person or brand, nothing violent or scary, nothing sexual or romantic and no weapon, drug or alcohol, with confidence. Anything else,
//     including no answer, withholds.
// The line a withheld picture gets is ONE short friendly sentence for the lane, never a lecture. The admin hears of it (no image), at most
// once in ten minutes for one person (ageCheck.recordWithheld).
import { decideAgeCheck, downscaleForCheck, markChatReaderUnusable, pictureReader, type PictureReader, recordWithheld, showsPossibleMinor, type AgeDecision, type CheckedKind, type ImageCheck } from "./ageCheck";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { completeViaStackRequest, type LlmMessage } from "@/lib/llm";
import { CHILD_CONTENT_LINE, laneOf, markKidWithheld, type Lane } from "./lane";

// ---------------------------------------------------------------- the child-safety question

export interface ChildSafetyVerdict {
  is_cartoon: boolean;
  looks_like_photo: boolean;
  brand_or_licensed_character: boolean;
  violent_or_scary: boolean;
  sexual_or_romantic: boolean;
  weapons_drugs_or_alcohol: boolean;
  confidence: number;
}
export type ChildSafetyCheck = { ok: true; verdict: ChildSafetyVerdict } | { ok: false; why: "no_vision" | "timeout" | "unavailable" | "unparsed" };

export const CHILD_SAFETY_SCHEMA = {
  name: "child_safety_check",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["is_cartoon", "looks_like_photo", "brand_or_licensed_character", "violent_or_scary", "sexual_or_romantic", "weapons_drugs_or_alcohol", "confidence"],
    properties: {
      is_cartoon: { type: "boolean" }, looks_like_photo: { type: "boolean" }, brand_or_licensed_character: { type: "boolean" },
      violent_or_scary: { type: "boolean" }, sexual_or_romantic: { type: "boolean" }, weapons_drugs_or_alcohol: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
} as const;

export const CHILD_SAFETY_SYSTEM_PROMPT = [
  "You are a safety classifier inside a family's private home computer. You are given ONE image that was made for a young child. Answer with a single JSON object and nothing else.",
  "Never describe the image, never name anyone, and never refuse: only classify.",
  "is_cartoon is true only when the image is clearly a drawn, painted or animated cartoon or illustration in a friendly style. looks_like_photo is true when it looks like a photograph or a realistic render.",
  "brand_or_licensed_character is true when a logo, brand or famous licensed character appears. Do not classify people or likenesses. violent_or_scary is true for violence, blood, gore, fear, horror or menace.",
  "sexual_or_romantic is true for anything nude, sexual, romantic or suggestive. weapons_drugs_or_alcohol is true when a weapon, a drug, alcohol or tobacco appears.",
  "When unsure, answer the unsafe way. confidence is your confidence in the whole answer, from 0 to 1.",
].join(" ");

const FLAGS = ["is_cartoon", "looks_like_photo", "brand_or_licensed_character", "violent_or_scary", "sexual_or_romantic", "weapons_drugs_or_alcohol"] as const;
export const MIN_CHILD_CONFIDENCE = 0.5;

export function parseChildSafety(text: string): ChildSafetyVerdict | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try { raw = JSON.parse(body); } catch {
    const start = body.indexOf("{"); const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { raw = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const flag of FLAGS) if (typeof o[flag] !== "boolean") return null;
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence)) return null;
  return {
    is_cartoon: o.is_cartoon as boolean, looks_like_photo: o.looks_like_photo as boolean, brand_or_licensed_character: o.brand_or_licensed_character as boolean,
    violent_or_scary: o.violent_or_scary as boolean, sexual_or_romantic: o.sexual_or_romantic as boolean, weapons_drugs_or_alcohol: o.weapons_drugs_or_alcohol as boolean,
    confidence: Math.max(0, Math.min(1, o.confidence)),
  };
}

/** Safe for a child only when every part of the answer says so, with confidence. */
export function childSafetyOk(check: ChildSafetyCheck): boolean {
  if (!check.ok) return false;
  const v = check.verdict;
  return v.is_cartoon && !v.looks_like_photo && !v.brand_or_licensed_character && !v.violent_or_scary && !v.sexual_or_romantic && !v.weapons_drugs_or_alcohol && v.confidence >= MIN_CHILD_CONFIDENCE;
}

let runnerForTests: ((images: readonly Uint8Array[]) => Promise<ChildSafetyCheck[]>) | null = null;
/** Test seam: replaces the child-safety run (null restores). */
export function __setChildSafetyRunnerForTests(fn: typeof runnerForTests): void { runnerForTests = fn; }
const DEADLINE_MS = 20_000;

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function askOne(bytes: Uint8Array, reader: PictureReader): Promise<ChildSafetyCheck> {
  let jpeg: Uint8Array;
  try { jpeg = await downscaleForCheck(bytes); } catch { return { ok: false, why: "unparsed" }; }
  const dataUrl = `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const messages: LlmMessage[] = [
      { role: "system", content: CHILD_SAFETY_SYSTEM_PROMPT },
      { role: "user", content: "Classify this image.", images: [{ id: "childcheck", name: "image", url: dataUrl, reservedTokens: 2560 }] },
    ];
    const result = await completeViaStackRequest(reader, {
      model: reader, messages, stream: false, temperature: 0, max_tokens: 160, // answer-budget
      response_format: { type: "json_schema", json_schema: CHILD_SAFETY_SCHEMA }, chat_template_kwargs: { enable_thinking: false },
    }, controller.signal);
    if (!result.ok) return { ok: false, why: controller.signal.aborted ? "timeout" : "unavailable" };
    const content = (result.data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
    const verdict = typeof content === "string" ? parseChildSafety(content) : null;
    return verdict ? { ok: true, verdict } : { ok: false, why: "unparsed" };
  } catch {
    return { ok: false, why: controller.signal.aborted ? "timeout" : "unavailable" };
  } finally { clearTimeout(timer); }
}

/** Asks the child-safety question of each image on the household's own vision model. Never throws; a failure is an answer the caller withholds on. */
export async function checkChildSafety(images: readonly Uint8Array[]): Promise<ChildSafetyCheck[]> {
  if (runnerForTests) return runnerForTests(images);
  return exclusive(async () => {
    let reader = await pictureReader();
    if (!reader) return images.map((): ChildSafetyCheck => ({ ok: false, why: "no_vision" }));
    const out: ChildSafetyCheck[] = [];
    for (const image of images) {
      let answer = await askOne(image, reader);
      if (!answer.ok && answer.why === "unavailable" && reader === "chat") {
        markChatReaderUnusable();
        const next = await pictureReader();
        if (next && next !== "chat") { reader = next; answer = await askOne(image, reader); }
      }
      out.push(answer);
    }
    return out;
  });
}

// ---------------------------------------------------------------- the decision

export interface LaneDecisionInput {
  lane: Lane;
  checks: readonly ImageCheck[];
  adultOnly: boolean;
  kind: CheckedKind;
  /** The child-safety answers, one per image (a child's pictures only). */
  childChecks?: readonly ChildSafetyCheck[];
}

/** The one decision for a finished picture or clip. The apparent-age decision for every viewer is ageCheck's (viewer-aware: a teen's or a child's is stricter and fails closed); this adds the child lane's own question and its friendly line. */
export function decideForLane(input: LaneDecisionInput): AgeDecision {
  const decision = decideAgeCheck(input.checks, input.adultOnly, input.kind, input.lane);
  const childLine = (reason: "minor_sexual" | "unchecked"): AgeDecision => (reason === "unchecked" ? decision : { action: "withhold", reason: "minor_sexual", line: CHILD_CONTENT_LINE });
  if (decision.action === "withhold") return input.lane === "child" ? childLine(decision.reason) : decision;
  if (input.lane === "child") {
    // Every picture or keyframe must pass the cartoon and child-safety question too; no answer withholds.
    const child = input.childChecks ?? [];
    if (child.length < input.checks.length || child.some((check) => !childSafetyOk(check))) return { action: "withhold", reason: "minor_sexual", line: CHILD_CONTENT_LINE };
  }
  return decision;
}

/** Whether any image of the check shows a possible minor (for the admin's log line). */

/** The lane a finished item is held to: the person's own band (the surface it was asked on is decided at the gate before it was made). */
export function laneOfPerson(actor: PersonRow): Lane { return laneOf({ actor, band: speakerAgeBand(actor, new Date()) }); }

export interface FinishedGateInput {
  actor: PersonRow;
  kind: CheckedKind;
  jobId: string;
  adultOnly: boolean;
  /** The apparent-age checks of the finished pictures or keyframes (ageCheck.checkImages). */
  checks: ImageCheck[];
  /** The same images, for a child's extra question. */
  images: readonly Uint8Array[];
  prompt?: string;
  promptHash?: string;
}

/** The one finished-item decision for pictures, clips and described edits: the adult decision is ageCheck's, a teen's and a child's is stricter (decideForLane). A withheld item is reported to the admins (no image, rate limited) for every lane. */
export async function gateFinished(input: FinishedGateInput): Promise<AgeDecision> {
  const lane = laneOfPerson(input.actor);
  const childChecks = lane === "child" ? await checkChildSafety(input.images) : undefined;
  const decision = decideForLane({ lane, checks: input.checks, adultOnly: input.adultOnly, kind: input.kind, ...(childChecks ? { childChecks } : {}) });
  if (decision.action === "withhold" && lane === "child") markKidWithheld(input.jobId);
  if (decision.action === "withhold" && (lane !== "adult" || decision.reason === "minor_sexual")) {
    await recordWithheld({ kind: input.kind, personId: input.actor.id, jobId: input.jobId, adultOnly: input.adultOnly, checks: input.checks, ...(input.prompt !== undefined ? { prompt: input.prompt } : {}), ...(input.promptHash !== undefined ? { promptHash: input.promptHash } : {}) });
  }
  return decision;
}
