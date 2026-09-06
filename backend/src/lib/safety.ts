import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { AgeBand } from "@/lib/ageBand";

// Session C step 7 (session-c-brain-and-voice.md): evaluateSafety() below
// used to derive its own `isMinor` boolean straight from `actor.role`
// (a MINOR_ROLES set, since removed) - a real, less accurate proxy than
// the birthdate-derived AgeBand turnEngine.ts's own prompt already
// computes for the identical actor on the identical turn ("the safety
// layer reads the ceiling through the band instead of the role proxy").
// A code review found notifications.ts's own "adults" audience filter
// used the same role proxy this file's old isMinorRole() exported - the
// two agreed by construction while both used role, but would have
// silently diverged the moment only this file switched to band, so that
// filter now shares this same AgeBand computation too
// (lib/notifications.ts's resolveRecipients()). isMinorRole()/MINOR_ROLES
// had no other caller left, so they're removed rather than kept as
// exported dead code.
function isMinorBand(band: AgeBand): boolean {
  return band !== "adult";
}

/** The one, real caller in a running conversation turn (turnEngine.ts's
 * prepareTurn(), runTurn(), and runTurnStream()'s gateOutputSafety() all
 * pass the actor's real AgeBand, computed once via lib/ageBand.ts's
 * speakerAgeBand()) - also exercised directly (routes/safety.ts,
 * tests/safety.test.ts) so the wiring is proven independent of any one
 * turn-engine caller. */
export function evaluateSafety(text: string, speakerBand: AgeBand): SafetyResult {
  const result = checkSafety(text, { isMinor: isMinorBand(speakerBand) });
  if (result.flagged) {
    // 4.3: "logged with the fact, never the transcript." No structured
    // host.log exists yet (that's 4.9's package host); this is a
    // fact-only line, never the checked text itself.
    console.log(
      `[safety] flagged categories=${result.categories.join(",")} action=${result.action} notify_parent=${result.notify_parent}`,
    );
  }
  return result;
}
