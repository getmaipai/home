// MINOR-SEARCH-01f (design row L7): before a child's or teen's query leaves
// the house, refuse it when it carries closed, exactly-checkable personal
// details: an email address, a phone number, a long id number, the household's
// stored address, or a household member's name. Deterministic formats and exact
// comparisons only (rule 1: no word list for meaning). Nothing here is logged
// with the query text (rule 6a); the caller returns the refusal copy only.
import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { entities, people } from "@/db/schema";
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import { speakerNamedAny } from "@/lib/subjects";

export type MinorQueryHit = "email" | "phone" | "id_number" | "address" | "household_name";

/** What the person is told. Problem, then the fix; same words for a child and a teen. */
export const MINOR_QUERY_PERSONAL_NOTE =
  "That search has a real name, address, phone number, email or ID number in it, so I didn't send it to the web. Ask again without those details, or ask a grown-up to help.";

const EMAIL_RE = /[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// A phone number: 10 digits in 3-3-4 groups (optional country code and brackets), or a 3-4 local number.
const PHONE_RE = /(?<![\d])(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d])/;
const LOCAL_PHONE_RE = /(?<![\d])\d{3}[-.]\d{4}(?![\d])/;
// Nine or more unbroken digits (an id, a card, an account), or a card in 4-4-4-4 groups. Shorter runs are ordinary numbers.
const LONG_DIGITS_RE = /(?<![\d])\d{9,}(?![\d])|(?<![\d])\d{4}([\s-])\d{4}\1\d{4}\1\d{1,4}(?![\d])/;
// A national-id shape: 3-2-4 digits.
const ID_SHAPE_RE = /(?<![\d])\d{3}-\d{2}-\d{4}(?![\d])/;

/** Closed-format hits in the query text alone (no household data). */
export function closedFormatHit(query: string): MinorQueryHit | null {
  if (query.length > 2000) query = query.slice(0, 2000);
  if (EMAIL_RE.test(query)) return "email";
  if (PHONE_RE.test(query) || LOCAL_PHONE_RE.test(query)) return "phone";
  if (ID_SHAPE_RE.test(query)) return "id_number";
  if (LONG_DIGITS_RE.test(query)) return "id_number";
  return null;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The household's stored address text: the home place's name, only when it has a digit
 * (a street number), so a bare "Home" never blocks an ordinary search. */
function householdAddress(): string | null {
  const id = getHouseholdSettingValue("household.home");
  if (typeof id !== "string") return null;
  const row = db.select({ name: entities.name }).from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get();
  const name = row ? squash(row.name) : "";
  return /\d/.test(name) && name.length >= 5 ? name : null;
}

function householdNames(): string[] {
  return db
    .select({ displayName: people.displayName, nickname: people.nickname })
    .from(people)
    .where(isNull(people.deletedAt))
    .all()
    .flatMap((p) => (p.nickname ? [p.displayName, p.nickname] : [p.displayName]));
}

/** Which closed detail, if any, a minor's search query carries. Adults are never checked. */
export function minorQueryHit(query: string, band: AgeBand): MinorQueryHit | null {
  if (band === "adult") return null;
  try {
    return minorQueryHitUnsafe(query);
  } catch {
    // Fail closed: if the household data cannot be read, the minor's query is not sent.
    return "household_name";
  }
}

function minorQueryHitUnsafe(query: string): MinorQueryHit | null {
  const format = closedFormatHit(query);
  if (format) return format;
  const address = householdAddress();
  if (address && ` ${squash(query)} `.includes(` ${address} `)) return "address";
  if (speakerNamedAny(query, householdNames())) return "household_name";
  return null;
}
