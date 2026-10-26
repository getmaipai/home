// LIKENESS-01: the steps every entry point takes before a picture or video that looks like a household adult is asked of
// the Stack (the chat tools, the card routes that make another one, the photo editor): resolve who it looks like, decide
// (age and surface gate, the subject is a living household adult, and the household option), make sure the Stack trusts
// Home's key, and sign a proof for that one thing. Nothing here asks the model anything.
import { isAdultContentRequest, decideLikeness, LIKENESS_LINES, NO_ADULT_CONTENT_NEGATIVE, subjectName, type LikenessMedium } from "./decide";
import { ensureStackTrust, mintProof, photoBind, PROOF_TTL_SECONDS } from "./proof";
import { getStyleSubject, type StyleMedium } from "./adapters";
import { ASK_TEMPORARY_LINE, openAsk, releaseAsk } from "./ask";
import type { JobLikeness } from "./guard";
import type { PictureAudience } from "@/lib/pictures/policy";
import { laneOf } from "@/lib/pictures/lane";
export type UseSource = "chat" | "editor";

export interface StyleRef { id: string; name: string; likeness_subject?: string | null; classification?: "all-ages" | "adult-only" }

export type LikenessPrep =
  | { kind: "none" }
  | { kind: "refused"; why: "real_person" | "likeness"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; adultContent: boolean; proof: string; job: JobLikeness; negativePrompt: string | null; askId?: string };

/** PERUSE-2026-10-25: what a style path passes so adult content of another household adult can wait for that adult's consent instead of being refused. Without it such a request is refused. */
export interface HeldRequest {
  /** The exact prompt that will be sent to the Stack (the pictured adult reads this text). */
  prompt: string;
  /** How many pictures (1 for a video). */
  count: number;
  /** A temporary or ephemeral chat keeps nothing, so no ask can be recorded there. */
  temporary: boolean;
}

export const MANY_PEOPLE_LINE = "I can make something that looks like one person at a time. Use styles of the same adult, or leave one out.";
export const STYLE_REMOVED_LINE = "That style is no longer available. I made nothing.";

/** Who a saved style looks like: Home's record of the answer given when it was added, else what the Stack's own record says. Null for an ordinary style. */
export function subjectOfStyle(medium: StyleMedium, style: StyleRef): { subjectId: string | null; removed: boolean } {
  const record = getStyleSubject(medium, style.id);
  if (record && record.state !== "active") return { subjectId: record.subjectPersonId, removed: true };
  return { subjectId: record?.subjectPersonId ?? style.likeness_subject ?? null, removed: false };
}

export interface StyleInput {
  medium: LikenessMedium;
  audience: PictureAudience;
  /** The style the request will apply, or null for none. */
  style: StyleRef | null;
  /** Everything the person asked for in words: the prompt and the style name. */
  text: string;
  /** The model's own statement that the person asked for a real, named or identifiable person. */
  depictsRealPerson: boolean;
  source: UseSource;
  held?: HeldRequest;
}

/** The likeness decision for a request that applies (or names) a style. */
export async function prepareStyleUse(input: StyleInput): Promise<LikenessPrep> {
  const { subjectId, removed } = input.style ? subjectOfStyle(input.medium, input.style) : { subjectId: null, removed: false };
  if (!input.style || !subjectId) {
    // Non-sexual real-person requests are allowed for an adult on their own written screen (owner, 2026-10-25); the prompt policy
    // already blocked the sexual ones. Everyone else (a child, a teen, a guest, a spoken turn, a shared screen) keeps the refusal.
    return input.depictsRealPerson && laneOf(input.audience) !== "adult" ? { kind: "refused", why: "real_person", line: "" } : { kind: "none" };
  }
  if (removed) return { kind: "refused", why: "likeness", line: STYLE_REMOVED_LINE };
  const adultContent = isAdultContentRequest({ text: input.text, otherAdultOnlyStyle: input.style.classification === "adult-only" });
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: subjectId, adultContent, allowAsk: input.held !== undefined });
  if (!decision.ok) return { kind: "refused", why: "likeness", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", why: "likeness", line: trust.line };
  const requester = input.audience.actor;
  if (decision.needsAsk) {
    // Adult content of another household adult: no proof now. The job is held until that adult consents (lib/likeness/ask.ts mints the proof on release).
    if (!input.held || input.held.temporary) return { kind: "refused", why: "likeness", line: input.held ? ASK_TEMPORARY_LINE : LIKENESS_LINES.adult_content_other_subject };
    const opened = openAsk({ subjectId: decision.subject.id, requesterId: requester.id, medium: input.medium, prompt: input.held.prompt, count: input.held.count, styleName: input.style.name, styleIds: [input.style.id], source: input.source });
    if (!opened.ok) return { kind: "refused", why: "likeness", line: opened.line };
    return {
      kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: false, adultContent: true, proof: "", askId: opened.id,
      job: { subject: decision.subject.id, requester: requester.id, way: "style", adult_content: true, ask: opened.id }, negativePrompt: null,
    };
  }
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, adultContent,
    proof: mintProof({ purpose: "style_use", subject: decision.subject.id, requester: requester.id, bind: input.style.id }),
    job: { subject: decision.subject.id, requester: requester.id, way: "style", adult_content: adultContent },
    negativePrompt: decision.self ? null : NO_ADULT_CONTENT_NEGATIVE,
  };
}

export type StylesPrep =
  | { kind: "none" }
  | { kind: "refused"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; adultContent: boolean; proofs: Map<string, string>; job: JobLikeness; negativePrompt: string | null; askId?: string };

/** The same decision for a request that applies several styles (Make another, a variation): every style of a person is decided and given its own proof; styles of two different people are refused; another adult-only style beside the likeness counts as adult content. */
export async function prepareStylesUse(input: Omit<StyleInput, "style" | "depictsRealPerson"> & { styles: readonly StyleRef[] }): Promise<StylesPrep> {
  const people = new Map<string, StyleRef[]>();
  for (const style of input.styles) {
    const { subjectId, removed } = subjectOfStyle(input.medium, style);
    if (!subjectId) continue;
    if (removed) return { kind: "refused", line: STYLE_REMOVED_LINE };
    people.set(subjectId, [...(people.get(subjectId) ?? []), style]);
  }
  if (people.size === 0) return { kind: "none" };
  if (people.size > 1) return { kind: "refused", line: MANY_PEOPLE_LINE };
  const [subjectId, likenessStyles] = [...people.entries()][0]!;
  const likenessIds = new Set(likenessStyles.map((s) => s.id));
  const adultContent = isAdultContentRequest({ text: input.text, otherAdultOnlyStyle: input.styles.some((s) => s.classification === "adult-only") });
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: subjectId, adultContent, allowAsk: input.held !== undefined });
  if (!decision.ok) return { kind: "refused", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", line: trust.line };
  const requester = input.audience.actor;
  if (decision.needsAsk) {
    // One ask covers every style of this person the job applies; each gets its own proof on release.
    if (!input.held || input.held.temporary) return { kind: "refused", line: input.held ? ASK_TEMPORARY_LINE : LIKENESS_LINES.adult_content_other_subject };
    const opened = openAsk({ subjectId: decision.subject.id, requesterId: requester.id, medium: input.medium, prompt: input.held.prompt, count: input.held.count, styleName: likenessStyles.map((s) => s.name).join(", "), styleIds: likenessStyles.map((s) => s.id), source: input.source });
    if (!opened.ok) return { kind: "refused", line: opened.line };
    return {
      kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: false, adultContent: true, proofs: new Map(), askId: opened.id,
      job: { subject: decision.subject.id, requester: requester.id, way: "style", adult_content: true, ask: opened.id }, negativePrompt: null,
    };
  }
  const proofs = new Map(likenessStyles.map((s) => [s.id, mintProof({ purpose: "style_use", subject: decision.subject.id, requester: requester.id, bind: s.id })] as const));
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, adultContent, proofs,
    job: { subject: decision.subject.id, requester: requester.id, way: "style", adult_content: adultContent },
    negativePrompt: decision.self ? null : NO_ADULT_CONTENT_NEGATIVE,
  };
}

export type PhotoPrep =
  | { kind: "refused"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; adultContent: boolean; proof: string; job: JobLikeness; negativePrompt: string | null };

export interface PhotoInput {
  medium: LikenessMedium;
  audience: PictureAudience;
  /** The household adult the requester says is in the photo. */
  declaredSubjectId: string | null;
  bytes: Uint8Array;
  text: string;
  /** Adult-only provenance inherited from a generated source picture. */
  adultContent?: boolean;
  source: UseSource;
}

/** The likeness decision for a request that starts from a photo of a declared household adult. The photo itself is checked separately (inspector.ts singleAdultPhoto), by the caller, before this. */
export const PHOTO_ADULT_LINE = "I never turn a photo of a real person into adult content. I can make something else from the photo.";

export async function preparePhotoUse(input: PhotoInput): Promise<PhotoPrep> {
  const requestedAdultContent = isAdultContentRequest({ text: input.text });
  const adultContent = requestedAdultContent || input.adultContent === true;
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: input.declaredSubjectId, adultContent });
  if (!decision.ok) return { kind: "refused", line: decision.line };
  if (requestedAdultContent) return { kind: "refused", line: PHOTO_ADULT_LINE };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", line: trust.line };
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, adultContent,
    proof: mintProof({ purpose: "photo", subject: decision.subject.id, requester: input.audience.actor.id, bind: photoBind(input.bytes) }),
    job: { subject: decision.subject.id, requester: input.audience.actor.id, way: "photo", adult_content: adultContent },
    negativePrompt: decision.self ? null : NO_ADULT_CONTENT_NEGATIVE,
  };
}

/**
 * PERUSE-2026-10-25: the moment a held job is released to the Stack. For adult content of another person this is the only place a
 * proof is minted: the ask must be approved, and the prompt and styles must be exactly what the pictured adult read. The proofs are
 * written into the body's styles. Anything that is not a held job returns ok and changes nothing.
 */
export async function proofHeldBody(
  job: { id: string; likeness: JobLikeness; medium: LikenessMedium },
  body: { prompt: string; loras?: Array<{ id: string; likeness_proof?: string }> } | undefined,
): Promise<{ ok: true } | { ok: false; line: string }> {
  const { likeness } = job;
  if (!likeness.adult_content || likeness.subject === likeness.requester) return { ok: true };
  if (!likeness.ask || !body) return { ok: false, line: LIKENESS_LINES.adult_content_other_subject };
  const styleIds = (body.loras ?? []).map((lora) => lora.id);
  const released = await releaseAsk({ askId: likeness.ask, jobId: job.id, subjectId: likeness.subject, requesterId: likeness.requester, medium: job.medium, prompt: body.prompt, styleIds });
  if (!released.ok) return released;
  for (const lora of body.loras ?? []) { const proof = released.proofs.get(lora.id); if (proof) lora.likeness_proof = proof; }
  return { ok: true };
}

export { LIKENESS_LINES, PROOF_TTL_SECONDS };
