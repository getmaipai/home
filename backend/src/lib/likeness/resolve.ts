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
