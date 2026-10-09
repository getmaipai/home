import { canManagePerson } from "@/apps/people/roles";
import type { Role } from "@/lib/api";

export interface EnrollTarget {
  id: string;
  role: Role;
}

/**
 * Frontend mirror of backend/src/lib/biometricPrints.ts's own
 * canConsentFor(): a child never consents for themself, full stop, on
 * top of the same self-or-MANAGEABLE_BY authority canManagePerson
 * already gives the "Use a real photo"/edit-profile gate. The backend
 * re-checks this on every POST /api/biometric-prints - the worst a wrong
 * answer here can do is show or hide the Enroll button, the same
 * acknowledged-duplication risk roles.ts's own canManagePerson already
 * documents and accepts codebase-wide (a capabilities endpoint would
 * remove it; none exists yet, per roles.ts's own comment). A code
 * review on this item (2026-09-29) named this a third hand-copy and
 * flagged it as a compounding risk rather than a new one - left as is,
 * matching the existing accepted pattern, not a fresh problem this item
 * introduced; a capabilities endpoint is a platform-wide change out of
 * this item's own scope.
 */
export function canEnrollFace(viewer: { id: string; role: Role }, target: EnrollTarget): boolean {
  if (target.role === "guest") return false;
  if (target.role === "teen") return viewer.id === target.id && viewer.role === "teen";
  if (target.role === "child" && viewer.id === target.id) return false;
  return canManagePerson(viewer.role, viewer.id, target);
}
