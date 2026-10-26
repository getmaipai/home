// LIKENESS-01: who the person says is in a photo, resolved against household identity. The requester declares the
// depicted adult; the model only carries their words into the tool call (rule 1: the model decides when a tool is
// needed, code checks what it may do). Only a living household member resolves: "someone else", a friend, a celebrity,
// a name that matches two people, or no name at all resolves to nothing, and the request is refused.
import { speakerAgeBand } from "@/lib/ageBand";
import { subjectEligibility } from "./eligibility";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const SELF_WORDS = new Set(["me", "myself", "i", "self", "my own", "it is me", "it s me", "that is me", "that s me"]);

/** The household member named (by display name or nickname, whole or first word, never guessing between two), or the requester for "me". Null for anyone else. */
export function resolveDeclaredPerson(declared: unknown, requester: PersonRow): PersonRow | null {
  if (typeof declared !== "string") return null;
  const wanted = norm(declared);
  if (!wanted || wanted.length > 80) return null;
  if (SELF_WORDS.has(wanted)) {
    const self = subjectEligibility(requester.id);
    return self.ok ? self.person : null;
  }
  // The name is matched across everyone who ever lived here, so a child, a guest or a memorial that shares it makes the answer ambiguous and the request fails closed.
  const adults = db.select().from(people).all() as PersonRow[];
  const exact = adults.filter((person) => norm(person.displayName) === wanted || (person.nickname && norm(person.nickname) === wanted));
  if (exact.length === 1) return subjectEligibility(exact[0]!.id).ok ? exact[0]! : null;
  if (exact.length > 1) return null;
  const first = adults.filter((person) => norm(person.displayName).split(" ")[0] === wanted || (person.nickname && norm(person.nickname).split(" ")[0] === wanted));
  return first.length === 1 && subjectEligibility(first[0]!.id).ok ? first[0]! : null;
}

const SELF_CLAIM = /\b(?:(?:photo|picture|pic|image|selfie|portrait|shot) of (?:me|myself)|(?:it|this|that) (?:is|s) me|i (?:am|m) (?:in|the one in)|me in (?:it|this|the)|my own (?:photo|picture|pic|image|selfie|face)|my (?:photo|picture|pic|selfie|face)|of myself)\b/;

/** Whether the person's own message names or claims who the model says is in the photo. The model's `photo_subject` is only a proposal: it can never be the attestation (a photo of a stranger plus an invented "me" is not a household photo). A self claim counts only for the speaker; anyone else counts only when the message names them. */
export function messageAttests(utterance: unknown, requester: PersonRow, declared: PersonRow | null): boolean {
  if (!declared || typeof utterance !== "string") return false;
  const text = norm(utterance);
  if (!text) return false;
  if (declared.id === requester.id) return SELF_CLAIM.test(text) || [declared.displayName, declared.nickname].some((n) => n && new RegExp(`\\b${norm(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  const candidates = [declared.displayName, declared.nickname, norm(declared.displayName).split(" ")[0], declared.nickname ? norm(declared.nickname).split(" ")[0] : null].filter((n): n is string => !!n).map(norm).filter((n) => n.length >= 2);
  return candidates.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

export const WHO_IS_IN_PHOTO_LINE = "Who is in this photo? Tell me which person in this household it shows (say their name, or say it is you). I only use a photo of someone who lives here.";

/** The household member a tool call may treat as the person in a photo: the model's proposal (`photo_subject`) resolved against the household, kept only when the person's own message names or claims them. The one rule for every tool that takes a photo and a subject (pictures and videos). */
export function attestedPerson(proposal: unknown, utterance: unknown, requester: PersonRow, remember?: { photoKeys: readonly string[]; on: boolean }): { proposed: PersonRow | null; attested: PersonRow | null } {
  const proposed = resolveDeclaredPerson(proposal, requester) ?? ownTeenPhoto(proposal, requester);
  if (!proposed) return { proposed, attested: null };
  const keys = (remember?.photoKeys ?? []).map((key) => `${requester.id}:${key}`);
  if (messageAttests(utterance, requester, proposed)) {
    // Ask at most once: what the person said about this photo is remembered (while the household has the extra questions off).
    if (remember?.on) for (const key of keys) attestations.set(key, proposed.id);
    return { proposed, attested: proposed };
  }
  // A photo the person already said who is in is not asked about again. The model never writes to this memory: only the person's own message does.
  if (remember?.on && keys.some((key) => attestations.get(key) === proposed.id)) return { proposed, attested: proposed };
  return { proposed, attested: null };
}

/** Who a person said is in a photo, by person and photo (its hash and its chain's first picture). Process memory only: a restart asks again once. */
const attestations = new Map<string, string>();
export function __resetAttestationsForTests(): void { attestations.clear(); }

/** A teen's own photo: "me" resolves to the teen themselves. It is only ever used for a non-sexual edit of their own photo (pictures/editSources.ts); a child never reaches it. */
function ownTeenPhoto(proposal: unknown, requester: PersonRow): PersonRow | null {
  if (typeof proposal !== "string" || !SELF_WORDS.has(norm(proposal))) return null;
  return speakerAgeBand(requester, new Date()) === "teen" && requester.role !== "guest" ? requester : null;
}
