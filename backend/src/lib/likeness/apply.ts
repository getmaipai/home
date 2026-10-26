// LIKENESS-01: the steps every entry point takes before a picture or video that looks like a household adult is asked of
// the Stack (the chat tools, the card routes that make another one, the photo editor): resolve who it looks like, decide
// (age and surface gate, the subject is a living household adult, and the household option), make sure the Stack trusts
// Home's key, and sign a proof for that one thing. Nothing here asks the model anything.
import { decideLikeness, LIKENESS_LINES, subjectName, type LikenessMedium } from "./decide";
import { ensureStackTrust, mintProof, photoBind, PROOF_TTL_SECONDS } from "./proof";
import { getStyleSubject, type StyleMedium } from "./adapters";
import type { JobLikeness } from "./guard";
import type { PictureAudience } from "@/lib/pictures/policy";
import { laneOf } from "@/lib/pictures/lane";
export type UseSource = "chat" | "editor";

export interface StyleRef { id: string; name: string; likeness_subject?: string | null; classification?: "all-ages" | "adult-only" }

export type LikenessPrep =
  | { kind: "none" }
  | { kind: "refused"; why: "real_person" | "likeness"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; proof: string; job: JobLikeness };

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
  /** The model's own statement that the person asked for a real, named or identifiable person. */
  depictsRealPerson: boolean;
  source: UseSource;
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
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: subjectId });
  if (!decision.ok) return { kind: "refused", why: "likeness", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", why: "likeness", line: trust.line };
  const requester = input.audience.actor;
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self,
    proof: mintProof({ purpose: "style_use", subject: decision.subject.id, requester: requester.id, bind: input.style.id }),
    job: { subject: decision.subject.id, requester: requester.id, way: "style" },
  };
}

export type StylesPrep =
  | { kind: "none" }
  | { kind: "refused"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; proofs: Map<string, string>; job: JobLikeness };

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
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: subjectId });
  if (!decision.ok) return { kind: "refused", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", line: trust.line };
  const requester = input.audience.actor;
  const proofs = new Map(likenessStyles.map((s) => [s.id, mintProof({ purpose: "style_use", subject: decision.subject.id, requester: requester.id, bind: s.id })] as const));
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self, proofs,
    job: { subject: decision.subject.id, requester: requester.id, way: "style" },
  };
}

export type PhotoPrep =
  | { kind: "refused"; line: string }
  | { kind: "likeness"; subjectId: string; subjectName: string; self: boolean; proof: string; job: JobLikeness };

export interface PhotoInput {
  medium: LikenessMedium;
  audience: PictureAudience;
  /** The household adult the requester says is in the photo. */
  declaredSubjectId: string | null;
  bytes: Uint8Array;
  source: UseSource;
}

/** The likeness decision for a request that starts from a photo of a declared household adult. The photo itself is checked separately (inspector.ts singleAdultPhoto), by the caller, before this. */
export async function preparePhotoUse(input: PhotoInput): Promise<PhotoPrep> {
  const decision = decideLikeness({ requester: input.audience, subjectPersonId: input.declaredSubjectId });
  if (!decision.ok) return { kind: "refused", line: decision.line };
  const trust = await ensureStackTrust();
  if (!trust.ok) return { kind: "refused", line: trust.line };
  return {
    kind: "likeness", subjectId: decision.subject.id, subjectName: subjectName(decision.subject), self: decision.self,
    proof: mintProof({ purpose: "photo", subject: decision.subject.id, requester: input.audience.actor.id, bind: photoBind(input.bytes) }),
    job: { subject: decision.subject.id, requester: input.audience.actor.id, way: "photo" },
  };
}

export { LIKENESS_LINES, PROOF_TTL_SECONDS };
