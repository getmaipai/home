// LIKENESS-01: the answer to "Who does this style look like?" when a style is added to the library. "Nobody (not a real
// person)" keeps the old rule (the Stack refuses a file whose own description says it is a real person); a household adult
// needs that adult's agreement now (or to be the one adding it), and the Stack gets Home's signed proof bound to the file's
// hash. A child, a teen, a guest, someone outside the household, a public figure or a link (whose bytes can change) is refused.
import { createHash } from "node:crypto";
import { consentState, subjectEligibility } from "./consent";
import { LIKENESS_LINES, subjectName } from "./decide";
import { ensureStackTrust, mintProof } from "./proof";
import { trigger } from "@/lib/notifications";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

export const NOBODY = "nobody";

export type StyleSubjectCheck =
  | { ok: true; kind: "nobody" }
  | { ok: true; kind: "person"; subject: PersonRow; self: boolean }
  | { ok: false; status: 403 | 422; code: string; line: string };

export const LOOKS_LIKE_REQUIRED_LINE = "Say who this style looks like: an adult in this household who has agreed, or Nobody if it is not a real person. Styles of anyone else are never added.";

/** Whether the answer is allowed right now. `adder` is the admin adding the style. */
export function checkStyleSubject(lookslike: string | undefined | null, adder: PersonRow): StyleSubjectCheck {
  const answer = (lookslike ?? "").trim();
  if (!answer) return { ok: false, status: 422, code: "likeness_unconfirmed", line: LOOKS_LIKE_REQUIRED_LINE };
  if (answer === NOBODY) return { ok: true, kind: "nobody" };
  const eligible = subjectEligibility(answer);
  if (!eligible.ok) {
    return { ok: false, status: 422, code: eligible.why === "minor" ? "subject_minor" : "subject_not_allowed", line: eligible.why === "minor"
      ? "I never add a style that looks like a child or a teen. Choose an adult in this household who has agreed, or Nobody if it is not a real person."
      : "I can only add a style that looks like an adult who lives in this household and has agreed. Choose one from the list, or Nobody if it is not a real person." };
  }
  const self = eligible.person.id === adder.id;
  if (!self && !consentState(eligible.person.id).adults) return { ok: false, status: 403, code: "consent_off", line: LIKENESS_LINES.consent_off(subjectName(eligible.person)) };
  return { ok: true, kind: "person", subject: eligible.person, self };
}

export function sha256Of(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** The fields the Stack takes for a style of a person: the subject and a proof bound to the file's hash. Null when the Stack does not trust this Home (the line says what to do). */
export async function stackLikenessFields(check: Extract<StyleSubjectCheck, { kind: "person" }>, adder: PersonRow, fileBytes: Uint8Array): Promise<{ likeness_subject: string; likeness_proof: string } | { error: string }> {
  const trust = await ensureStackTrust();
  if (!trust.ok) return { error: trust.line };
  return { likeness_subject: check.subject.id, likeness_proof: mintProof({ purpose: "style_import", subject: check.subject.id, requester: adder.id, bind: sha256Of(fileBytes) }) };
}

/** Tells the person a style that looks like them was added to the library. Never throws. */
export async function notifyStyleAdded(subjectId: string, adder: PersonRow, medium: "picture" | "video"): Promise<void> {
  if (subjectId === adder.id) return;
  try {
    const row = db.select().from(people).where(eq(people.id, adder.id)).get();
    await trigger("likeness.used", { who: row ? (row.nickname?.trim() || row.displayName) : "Someone in your household", kind: `a saved ${medium} style of you` }, { personId: subjectId, subjectPersonId: adder.id });
  } catch { /* the style is saved either way */ }
}
