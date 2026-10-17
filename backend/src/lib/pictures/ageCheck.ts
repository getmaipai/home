// IMGGEN-SAFE-01 / VIDEO-GEN: the second, independent check on a FINISHED picture or clip, before the person sees it.
// The first check is the prompt floor (minorLine.ts): a word list, which a new phrasing can slip past. This one looks at
// the pixels. The ABSOLUTE LINE (docs/design/RULES.md rule 0, SAFETY.md): nothing sexual involving a minor or a
// minor-looking person, for anyone, with no setting that reaches it.
//
// The whole policy is in this file: when a check runs (always, since the vision answer itself says "no people"), what
// the local vision model is asked, how its answer is read, the one decision function (`decideAgeCheck`), the refusal
// lines and the safety event. The model is the household's own chat model reading the picture through its projector, on
// this computer, through the Stack's chat route: zero outbound, no cloud service, a downscaled copy with no EXIF, and
// the picture never stored by the check. The decision and the parsing are pure and tested with scripted verdicts; no
// test needs, makes or looks at an explicit image.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { toWireMessage, type LlmMessage } from "@/lib/llm";
import { trigger } from "@/lib/notifications";
import { getStackClient } from "@/lib/stackEngine";
import { mentionsMinorCue, mentionsSexualWord, mentionsUnclothedPhrase } from "./minorLine";

// ---------------------------------------------------------------- the lines the person reads

export type CheckedKind = "picture" | "video";

/** The refusal when the check found a possible child in a sexual situation (or any possible child in an adult-only job). Fixed wording, owner-approved 2026-10-17. */
export function minorRefusalLine(kind: CheckedKind): string {
  return `I can't show that ${kind}. It may show a child in a sexual situation, and that is never allowed.`;
}

/** The line when an adult-only job could not be checked: it fails closed. */
export function uncheckedRefusalLine(kind: CheckedKind): string {
  return `I couldn't check that ${kind}, so I can't show it. Try again in a minute.`;
}

// ---------------------------------------------------------------- the verdict

export type AgeLabel = "adult" | "possibly_minor" | "child" | "none";

/** What the vision model is asked for, per image. `label` and `apparent_min_age_estimate` describe the YOUNGEST depicted person. */
export interface AgeVerdict {
  people_count: number;
  apparent_min_age_estimate: number | null;
  label: AgeLabel;
  is_nude_or_sexual: boolean;
  confidence: number;
}

export type CheckFailure = "no_vision" | "memory" | "timeout" | "unavailable" | "unparsed";

/** One image's result: a verdict, or why there is none. */
export type ImageCheck = { ok: true; verdict: AgeVerdict } | { ok: false; why: CheckFailure };

export const VERDICT_SCHEMA = {
  name: "age_check",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["people_count", "apparent_min_age_estimate", "label", "is_nude_or_sexual", "confidence"],
    properties: {
      people_count: { type: "integer", minimum: 0, maximum: 50 },
      apparent_min_age_estimate: { type: ["integer", "null"], minimum: 0, maximum: 120 },
      label: { type: "string", enum: ["adult", "possibly_minor", "child", "none"] },
      is_nude_or_sexual: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
} as const;

/** The strict system prompt. It asks for a classification only: no description, no names, nothing about who anyone is. */
export const AGE_CHECK_SYSTEM_PROMPT = [
  "You are a safety classifier inside a family's private home computer. You are given ONE image. Answer with a single JSON object and nothing else.",
  "Never describe the image, never name or identify anyone, and never refuse: only classify.",
  "people_count is the number of depicted people (a photograph, a drawing, a painting, a render or a cartoon all count; a statue or a toy does not).",
  "For the YOUNGEST depicted person give apparent_min_age_estimate (a whole number of years: how young that person looks) and label:",
  "adult = clearly 18 or older; possibly_minor = could be under 18, or you are unsure; child = looks under 13; none = nobody is depicted.",
  "When unsure between adult and possibly_minor, choose possibly_minor. When nobody is depicted, label is none and apparent_min_age_estimate is null.",
  "is_nude_or_sexual is true when any depicted person is nude or partly nude beyond ordinary swimwear, or is shown in a sexual or sexualized pose or act.",
  "confidence is your confidence in the whole answer, from 0 to 1.",
].join(" ");

const AGE_USER_TEXT = "Classify this image.";

/** Reads the model's text into a verdict, or null when it is not a usable, self-consistent answer. */
export function parseVerdict(text: string): AgeVerdict | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { raw = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const count = o.people_count;
  const label = o.label;
  const sexual = o.is_nude_or_sexual;
  const confidence = o.confidence;
  const estimate = o.apparent_min_age_estimate;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  if (label !== "adult" && label !== "possibly_minor" && label !== "child" && label !== "none") return null;
  if (typeof sexual !== "boolean") return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (estimate !== null && estimate !== undefined && (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0)) return null;
  // "None" with people counted, or a person label with nobody counted and no age, contradict themselves: not a verdict to trust either way.
  if (label === "none" && count > 0) return null;
  if (label === "adult" && count === 0) return null;
  return { people_count: count, apparent_min_age_estimate: typeof estimate === "number" ? Math.round(estimate) : null, label, is_nude_or_sexual: sexual, confidence: Math.max(0, Math.min(1, confidence)) };
}

/** A verdict the model is not sure of is not an "adult" verdict: below this confidence an adult label counts as possibly_minor. */
export const MIN_ADULT_CONFIDENCE = 0.5;

/**
 * The label with the model's other answers taken into account, always toward the younger reading: an "adult" label beside an
 * estimated age under 18, or with confidence under 0.5, is read as the younger answer.
 */
export function effectiveLabel(verdict: AgeVerdict): AgeLabel {
  const age = verdict.apparent_min_age_estimate;
  let label = verdict.label;
  if (age !== null) {
    if (age < 13 && label !== "child") label = "child";
    else if (age < 18 && label !== "child" && label !== "possibly_minor") label = "possibly_minor";
  }
  if (label === "adult" && verdict.confidence < MIN_ADULT_CONFIDENCE) label = "possibly_minor";
  return label;
}

export function showsPossibleMinor(verdict: AgeVerdict): boolean {
  const label = effectiveLabel(verdict);
  return label === "child" || label === "possibly_minor";
}

// ---------------------------------------------------------------- the decision

export type AgeDecision =
  | { action: "allow" }
  | { action: "withhold"; reason: "minor_sexual"; line: string }
  | { action: "withhold"; reason: "unchecked"; line: string };

/** Who is looking: the stricter of the turn's band and the person's own band. Adults are unchanged; a teen or a child gets the stricter rules in `decideAgeCheck`. */
export type Viewer = "adult" | "teen" | "child";

/** The viewer band for a person on their own: the person's age band (role and birthdate, the stricter). A caller that also knows the turn's band passes the stricter of the two. */
export function viewerOf(actor: PersonRow, turnBand?: Viewer): Viewer {
  const own: Viewer = speakerAgeBand(actor, new Date());
  const rank: Record<Viewer, number> = { child: 0, teen: 1, adult: 2 };
  return turnBand && rank[turnBand] < rank[own] ? turnBand : own;
}

/** The line a teen or a child reads when a finished picture or clip is withheld for them: one friendly sentence, no reason, no wording that names what was found. */
export const MINOR_VIEWER_LINE = "I can't show that one. Want to try something different?";

/**
 * The one decision, for a picture (one check) or a clip (three keyframe checks).
 * ADULT viewer (the default, unchanged):
 *  - any depicted person possibly a minor or a child AND (the image is nude or sexual OR the job is adult-only): WITHHOLD;
 *  - a check that could not run on an adult-only job: WITHHOLD (fails closed);
 *  - a check that could not run on an ordinary job: ALLOW (fails open, so an ordinary picture is never blocked by a busy model);
 *  - everything else: ALLOW (an adult, nobody, or a possible minor in an ordinary, not sexual picture such as a cartoon child with a balloon).
 * TEEN or CHILD viewer (the stricter rules; no setting reaches them):
 *  - anything nude or sexual is WITHHELD whoever is in it (an adult in it does not matter);
 *  - an adult-only job is never shown to them: WITHHELD;
 *  - a check that could not run, for any job, is WITHHELD (fails closed);
 *  - everything else: ALLOW (the child lane's own extra question is the lane's, laneGate.ts).
 * A minor finding outranks a failed check on another frame.
 */
export function decideAgeCheck(checks: readonly ImageCheck[], adultOnly: boolean, kind: CheckedKind, viewer: Viewer = "adult"): AgeDecision {
  if (viewer !== "adult") {
    if (adultOnly || checks.some((check) => check.ok && check.verdict.is_nude_or_sexual)) return { action: "withhold", reason: "minor_sexual", line: MINOR_VIEWER_LINE };
    if (checks.length === 0 || checks.some((check) => !check.ok)) return { action: "withhold", reason: "unchecked", line: uncheckedRefusalLine(kind) };
    return { action: "allow" };
  }
  for (const check of checks) {
    if (check.ok && showsPossibleMinor(check.verdict) && (check.verdict.is_nude_or_sexual || adultOnly)) {
      return { action: "withhold", reason: "minor_sexual", line: minorRefusalLine(kind) };
    }
  }
  if (adultOnly && (checks.length === 0 || checks.some((check) => !check.ok))) {
    return { action: "withhold", reason: "unchecked", line: uncheckedRefusalLine(kind) };
  }
  return { action: "allow" };
}

// ---------------------------------------------------------------- is the job adult-only

export type AdapterClass = "all-ages" | "adult-only";

/**
 * Whether a job is adult-only: the prompt carries a sexual or nudity word or a plain "no clothes" phrase, or any style used is adult-only. A style the
 * library no longer knows (`undefined`) counts as adult-only: the check cannot tell what it did.
 */
export async function isAdultOnlyJob(prompt: string, styleIds: readonly string[], classOf: (id: string) => Promise<AdapterClass | undefined>): Promise<boolean> {
  if (mentionsSexualWord(prompt)) return true;
  if (mentionsUnclothedPhrase(prompt)) return true;
  for (const id of styleIds) {
    let cls: AdapterClass | undefined;
    try { cls = await classOf(id); } catch { cls = undefined; }
    if (cls !== "all-ages") return true;
  }
  return false;
}

// ---------------------------------------------------------------- one image through the local vision model

const CHECK_MAX_SIDE = 768;
let CHECK_DEADLINE_MS = 20_000;
/** Test seam: a shorter deadline (null restores). */
export function __setAgeDeadlineForTests(ms: number | null): void { CHECK_DEADLINE_MS = ms ?? 20_000; }
const MEMORY_WAIT_MS = 4_000;
const MEMORY_POLL_MS = 1_000;

/** A copy for the check: 768 px at most on the long side, JPEG, no EXIF or other metadata, flattened on white. */
export async function downscaleForCheck(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes, { failOn: "error", limitInputPixels: 64_000_000 })
    .rotate()
    .resize({ width: CHECK_MAX_SIDE, height: CHECK_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(out);
}

/** Test seam: answers the model call with the model's raw text for one downscaled image (throw for a failure). While set, the readiness and memory checks are skipped. */
export type VisionCall = (image: { dataUrl: string }) => Promise<string>;
let visionForTests: VisionCall | null = null;
export function __setAgeVisionForTests(fn: VisionCall | null): void { visionForTests = fn; }

/** Test seam: replaces a whole check run (used by the job tests, which are not about the model). */
type RunChecks = (images: readonly Uint8Array[], kind: CheckedKind) => Promise<ImageCheck[]>;
let runForTests: RunChecks | null = null;
export function __setAgeCheckRunnerForTests(fn: RunChecks | null): void { runForTests = fn; }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Whether the resident chat model is up and declares picture input. This is the model's own capability; the per-picture token bound that chat turns need for window accounting is not needed for a single small image. Any failure to read the Stack reads as "no". */
async function chatReadsPictures(): Promise<boolean> {
  try {
    const { roles } = await getStackClient().roles({ signal: AbortSignal.timeout(5_000) });
    const row = roles.find((role) => role.id === "chat");
    const state = row?.state.state;
    return (state === "ready" || state === "loaded" || state === "installed") && row?.model?.imageInput === true;
  } catch {
    return false;
  }
}

/** True when the Stack says memory is critical, after waiting a few seconds for it to ease. A budget the Stack cannot read counts as fine. */
async function memoryIsCritical(): Promise<boolean> {
  const until = Date.now() + MEMORY_WAIT_MS;
  for (;;) {
    let critical = false;
    try {
      critical = (await getStackClient().budget({ signal: AbortSignal.timeout(3_000) })).pressure === "critical";
    } catch {
      return false;
    }
    if (!critical) return false;
    if (Date.now() >= until) return true;
    await sleep(MEMORY_POLL_MS);
  }
}

async function askModel(dataUrl: string, signal: AbortSignal): Promise<string> {
  if (visionForTests) return visionForTests({ dataUrl });
  const messages: LlmMessage[] = [
    { role: "system", content: AGE_CHECK_SYSTEM_PROMPT },
    { role: "user", content: AGE_USER_TEXT, images: [{ id: "agecheck", name: "image", url: dataUrl, reservedTokens: 2560 }] },
  ];
  const result = await getStackClient().chat({
    model: "chat",
    messages: messages.map(toWireMessage),
    stream: false,
    temperature: 0,
    max_tokens: 160,
    response_format: { type: "json_schema", json_schema: VERDICT_SCHEMA },
    // The smallest thinking budget there is: none. The answer is a label, not a reasoning problem.
    chat_template_kwargs: { enable_thinking: false },
  }, { signal });
  if ("stream" in result) throw new Error("the Stack streamed a non-streaming request");
  const data = result.data as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no answer");
  return content;
}

/** One at a time: the check is a chat request on the resident model, and a second one waits rather than crowding it. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function checkOne(bytes: Uint8Array): Promise<ImageCheck> {
  let jpeg: Uint8Array;
  try { jpeg = await downscaleForCheck(bytes); } catch { return { ok: false, why: "unparsed" }; }
  const dataUrl = `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_DEADLINE_MS);
  try {
    const raw = await Promise.race([
      askModel(dataUrl, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
    const verdict = parseVerdict(raw);
    if (!verdict) console.warn(`[age-check] the model's answer was not a usable verdict (${raw.length} characters)`);
    return verdict ? { ok: true, verdict } : { ok: false, why: "unparsed" };
  } catch (error) {
    return { ok: false, why: controller.signal.aborted || (error as Error).message === "timeout" ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Checks each image in order, sequentially, on the local vision model. Never throws. */
export async function checkImages(images: readonly Uint8Array[], kind: CheckedKind): Promise<ImageCheck[]> {
  if (runForTests) return runForTests(images, kind);
  return exclusive(async () => {
    if (!visionForTests) {
      if (!(await chatReadsPictures())) return images.map((): ImageCheck => ({ ok: false, why: "no_vision" }));
      if (await memoryIsCritical()) return images.map((): ImageCheck => ({ ok: false, why: "memory" }));
    }
    const checks: ImageCheck[] = [];
    for (const image of images) checks.push(await checkOne(image));
    return checks;
  });
}

// ---------------------------------------------------------------- an uploaded image used as INPUT (edit, video, reference)

export type InputScreen = { ok: true } | { ok: false; code: "input_minor_cue" | "input_minor_sexual" | "input_unchecked"; line: string };

/** The line when words about a child come with a photo to change. Fixed wording; it names no term. */
export const INPUT_MINOR_CUE_LINE = "I can't change a photo into a picture of a child. Describe a new picture from scratch instead.";
export const INPUT_MINOR_SEXUAL_LINE = "I can't change that photo. A photo that may show a child is never changed that way.";

/**
 * The input-side floor, for a picture that this home did NOT make (an upload, a household photo, a reference): it is screened before
 * it is sent to the picture or video engine. Same local vision model and same single pass as the finished-output check.
 *  - the words carry a minor marker or an age under 18 (no sexual word needed): refused, whatever the photo shows; this is the
 *    legacy rule that turning a photo toward a child is never done (a picture this home made is not screened here: a cartoon edit is ordinary);
 *  - the photo may show a minor AND (the photo is nude or sexual, or the words ask for anything sexual, nude, or unclothed): refused;
 *  - the photo is nude or sexual and the viewer is a teen or a child: refused;
 *  - the check could not run: refused when the words ask for anything sexual or the viewer is a teen or a child (fails closed), otherwise allowed
 *    (the likeness gate still requires a photo with no person, or one adult, by its own check).
 */
export async function screenInputImage(bytes: Uint8Array, prompt: string, viewer: Viewer = "adult"): Promise<InputScreen> {
  if (mentionsMinorCue(prompt)) return { ok: false, code: "input_minor_cue", line: viewer === "adult" ? INPUT_MINOR_CUE_LINE : MINOR_VIEWER_LINE };
  const sexualAsk = mentionsSexualWord(prompt) || mentionsUnclothedPhrase(prompt);
  const [check] = await checkImages([bytes], "picture");
  if (!check || !check.ok) {
    if (sexualAsk || viewer !== "adult") return { ok: false, code: "input_unchecked", line: viewer === "adult" ? uncheckedRefusalLine("picture") : MINOR_VIEWER_LINE };
    return { ok: true };
  }
  const v = check.verdict;
  if ((showsPossibleMinor(v) && (v.is_nude_or_sexual || sexualAsk)) || (viewer !== "adult" && v.is_nude_or_sexual)) {
    return { ok: false, code: "input_minor_sexual", line: viewer === "adult" ? INPUT_MINOR_SEXUAL_LINE : MINOR_VIEWER_LINE };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- the safety event

const NOTIFY_EVERY_MS = 10 * 60 * 1000;
const lastNotified = new Map<string, number>();
export function __resetAgeCheckEventsForTests(): void { lastNotified.clear(); }

export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt.normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 16);
}

export interface WithheldEvent {
  kind: CheckedKind;
  personId: string;
  jobId: string;
  /** The words (hashed here, never logged) or, where the caller already holds only a hash, that hash. */
  prompt?: string;
  promptHash?: string;
  adultOnly: boolean;
  checks: readonly ImageCheck[];
}

/**
 * Records that something was withheld: one structured log line (the verdict and a hash of the prompt, never the image or
 * the prompt text) and an admin notification with no image (rule S6: Notifications, for what needs an admin's attention
 * and not a person's screen), at most once every ten minutes for one person. There is no per-person strike counter in
 * Home today; the log line is where a repeated pattern shows (the same prompt hash).
 */
export async function recordWithheld(event: WithheldEvent): Promise<void> {
  const minor = event.checks.find((check) => check.ok && showsPossibleMinor(check.verdict));
  const verdict = minor && minor.ok ? minor.verdict : null;
  console.warn(`[age-check] withheld ${JSON.stringify({
    kind: event.kind, job: event.jobId, person: event.personId, prompt_hash: event.promptHash ?? promptHash(event.prompt ?? ""), adult_only: event.adultOnly,
    label: verdict ? effectiveLabel(verdict) : null, age: verdict?.apparent_min_age_estimate ?? null, people: verdict?.people_count ?? null,
    sexual: verdict?.is_nude_or_sexual ?? null, confidence: verdict?.confidence ?? null,
  })}`);
  const now = Date.now();
  const last = lastNotified.get(event.personId);
  if (last !== undefined && now - last < NOTIFY_EVERY_MS) return;
  try {
    const row = db.select({ name: people.displayName }).from(people).where(eq(people.id, event.personId)).get();
    await trigger("safety.picture_withheld", { kind: event.kind, personName: row?.name ?? "Someone" });
    // Only a notification that went out starts the quiet period: a failed one is tried again on the next withheld item.
    lastNotified.set(event.personId, now);
  } catch (error) {
    console.error(`[age-check] the admin notification failed: ${(error as Error).message}`);
  }
}
