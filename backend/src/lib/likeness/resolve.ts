// LIKENESS-01: who the person says is in a photo, resolved against the household's adults. The requester declares the
// depicted adult; the model only carries their words into the tool call (rule 1: the model decides when a tool is
// needed, code checks what it may do). Only a household adult resolves: "someone else", a friend, a celebrity, a child,
// a name that matches two people, or no name at all resolves to nothing, and the request is refused.
import { subjectEligibility } from "./consent";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const SELF_WORDS = new Set(["me", "myself", "i", "self", "my own", "it is me", "it s me", "that is me", "that s me"]);

/** The household adult named (by display name or nickname, whole or first word, never guessing between two), or the requester for "me". Null for anyone else. */
export function resolveDeclaredAdult(declared: unknown, requester: PersonRow): PersonRow | null {
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

/** Whether the person's own message names or claims the adult the model says is in the photo. The model's `photo_subject` is only a proposal: it can never be the attestation (a photo of a stranger plus an invented "me" is not a household photo). A self claim counts only for the speaker; anyone else counts only when the message names them (whole name, nickname or first name, as resolveDeclaredAdult matched it). */
export function messageAttests(utterance: unknown, requester: PersonRow, declared: PersonRow | null): boolean {
  if (!declared || typeof utterance !== "string") return false;
  const text = norm(utterance);
  if (!text) return false;
  if (declared.id === requester.id) return SELF_CLAIM.test(text) || [declared.displayName, declared.nickname].some((n) => n && new RegExp(`\\b${norm(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  const candidates = [declared.displayName, declared.nickname, norm(declared.displayName).split(" ")[0], declared.nickname ? norm(declared.nickname).split(" ")[0] : null].filter((n): n is string => !!n).map(norm).filter((n) => n.length >= 2);
  return candidates.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}
