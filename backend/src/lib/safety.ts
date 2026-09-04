import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { Role } from "@/middleware/auth";

// 4.2's two minor bands map onto 4.3's "minor speaker" context. Age-band
// derivation from birthdate doesn't exist yet (deferred, see
// docs/dev.md), so role is the proxy available today; a robot-local guest
// profile could in principle be a child with no way to know that yet,
// which is a documented gap until age_range lands.
const MINOR_ROLES: ReadonlySet<Role> = new Set(["teen", "child"]);

export function isMinorRole(role: Role): boolean {
  return MINOR_ROLES.has(role);
}

// The turn engine (4.5) doesn't exist yet, so nothing calls this on a real
// conversation turn today. This is exercised directly (routes/safety.ts,
// tests/safety.test.ts) so the wiring is proven ahead of having a turn to
// hook it into, the same way the recipe interpreters were proven against
// fixtures before any package called them.
export function evaluateSafety(text: string, speakerRole: Role): SafetyResult {
  const result = checkSafety(text, { isMinor: isMinorRole(speakerRole) });
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
