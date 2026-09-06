// Age band derivation (originally session-a-intelligence.md step 1,
// computed inline in turnEngine.ts for the prompt only). Session C step
// 7 (session-c-brain-and-voice.md) pulls it out here so the safety layer
// can share the identical computation ("the safety layer reads the
// ceiling through the band instead of the role proxy" - a real, if
// unglamorous, "one definition, one place" fix: `evaluateSafety()` was
// deriving its own `isMinor` boolean from `actor.role` directly, an
// independent, less accurate signal than the birthdate-based band
// turnEngine.ts's prompt already used for the exact same person on the
// exact same turn).
//
// Deliberately narrow: just enough to calibrate a reply's phrasing and a
// safety check's leniency for the speaker in front of it. This is NOT
// the wider `age_range`-on-package-`ctx` question the plan also names for
// this step - that needs session-f-platform-and-trust.md step 7's own
// package-host `ctx` mechanism, which does not exist yet (F is at step 5
// as of this writing); a real, deferred gap, not silently skipped - see
// docs/dev/session-c.md's step 7 entry. The three bands mirror the role
// ladder's own two minor bands (person.schema.json: "teen 13-17, child
// under 13") rather than inventing a finer taxonomy nothing in the spec
// or platform plan defines - a real, independent cross-check computed
// from birthdate when one is on file, falling back to the speaker's role
// (which already carries the same distinction) when it isn't.
import type { PersonRow } from "@/types";

export type AgeBand = "child" | "teen" | "adult";

function ageInYears(birthdate: string, now: Date): number {
  const dob = new Date(birthdate);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function ageBandFromRole(role: string): AgeBand {
  if (role === "child") return "child";
  if (role === "teen") return "teen";
  return "adult"; // owner/admin/adult/guest: role carries no minor signal
}

// child < teen < adult, most restrictive first. Used below to take the
// STRICTER of the role-derived and birthdate-derived bands, never the
// looser one.
const BAND_STRICTNESS: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

/** The one, shared age-band computation - turnEngine.ts's prompt
 * (speakerLine()) and safety.ts's evaluateSafety() both call this for the
 * same actor on the same turn, rather than each deriving their own
 * answer from a different signal.
 *
 * A code review (2026-09-06, SEC-8) found birthdate could OVERRIDE role
 * in either direction: a `child`-role person free to edit their own
 * birthdate (routes/people.ts's self-edit rule) could set it to any
 * adult year and read as "age band adult" here, loosening tone and
 * content calibration role alone would have kept strict (the safety
 * classifier itself still gates on role independently, so refusals held,
 * but this is the identical signal evaluateSafety() reads for
 * leniency). Role is now a FLOOR: birthdate may only make the band
 * stricter than role would (an `adult`-role person with a birthdate on
 * file that says teen still reads as teen, which was always the point of
 * checking birthdate at all), never looser. */
export function speakerAgeBand(actor: PersonRow, now: Date): AgeBand {
  const roleBand = ageBandFromRole(actor.role);
  if (!actor.birthdate) return roleBand;
  const years = ageInYears(actor.birthdate, now);
  // A malformed birthdate (Person's generated Zod schema enforces
  // `.date()` today, so this shouldn't be reachable through any real
  // write path, but a code review, 2026-09-05, pointed out nothing here
  // defended against it anyway) must never silently fall through to
  // "adult": both `years < 13` and `years < 18` are false for NaN,
  // which is exactly the wrong direction for a safety-adjacent signal.
  if (Number.isNaN(years)) return roleBand;
  const birthdateBand: AgeBand = years < 13 ? "child" : years < 18 ? "teen" : "adult";
  return BAND_STRICTNESS[birthdateBand] < BAND_STRICTNESS[roleBand] ? birthdateBand : roleBand;
}
