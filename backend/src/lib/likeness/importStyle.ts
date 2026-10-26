// LIKENESS-01: keep a household subject binding on imported styles and sign the proof bound to the file hash.
import { createHash } from "node:crypto";
import { subjectEligibility } from "./eligibility";
import { LIKENESS_LINES, subjectName } from "./decide";
import { ensureStackTrust, mintProof } from "./proof";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

export const NOBODY = "nobody";

export type StyleSubjectCheck =
  | { ok: true; kind: "nobody" }
  | { ok: true; kind: "person"; subject: PersonRow; self: boolean }
  | { ok: false; status: 403 | 422; code: string; line: string };

export const LOOKS_LIKE_REQUIRED_LINE = "Say who this style looks like: a person in this household, or Nobody if it is not a real person. Styles of anyone else are never added.";

/** Whether the answer is allowed right now. `adder` is the admin adding the style. */
export function checkStyleSubject(lookslike: string | undefined | null, adder: PersonRow): StyleSubjectCheck {
  const answer = (lookslike ?? "").trim();
  if (!answer) return { ok: false, status: 422, code: "likeness_unconfirmed", line: LOOKS_LIKE_REQUIRED_LINE };
  if (answer === NOBODY) return { ok: true, kind: "nobody" };
  const eligible = subjectEligibility(answer);
  if (!eligible.ok) {
    return { ok: false, status: 422, code: "subject_not_allowed", line: "I can only add a style that looks like a living member of this household. Choose one from the list, or Nobody if it is not a real person." };
  }
  const self = eligible.person.id === adder.id;
  return { ok: true, kind: "person", subject: eligible.person, self };
}

export function sha256Of(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** The fields the Stack takes for a style of a person: the subject and a proof bound to the file's hash. Null when the Stack does not trust this Home (the line says what to do). */
export async function stackLikenessFields(check: Extract<StyleSubjectCheck, { kind: "person" }>, adder: PersonRow, fileBytes: Uint8Array): Promise<{ likeness_subject: string; likeness_proof: string } | { error: string }> {
  const trust = await ensureStackTrust();
  if (!trust.ok) return { error: trust.line };
  return { likeness_subject: check.subject.id, likeness_proof: mintProof({ purpose: "style_import", subject: check.subject.id, requester: adder.id, bind: sha256Of(fileBytes) }) };
}
