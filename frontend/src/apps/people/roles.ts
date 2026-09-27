import type { Person } from "@maipai/spec/gen/ts/person.js";
import { isOwnerOrAdminRole, type Role } from "@/lib/api";

type Accent = NonNullable<Person["accent"]>;

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  adult: "Adult",
  teen: "Teen",
  child: "Child",
  guest: "Guest",
};

// Mirrors backend/src/middleware/auth.ts's ROLE_LADDER and
// backend/src/lib/plugins.ts's meetsMinRole exactly - the same
// "acknowledged duplication, worst case hides a button" risk
// CREATABLE_BY below already documents for the identical reason (the
// server re-checks every one of these itself).
export const ROLE_LADDER: readonly Role[] = ["owner", "admin", "adult", "teen", "child", "guest"];

export function meetsMinRole(actorRole: Role, minRole: Role): boolean {
  const actorIdx = ROLE_LADDER.indexOf(actorRole);
  const minIdx = ROLE_LADDER.indexOf(minRole);
  if (actorIdx === -1 || minIdx === -1) return false;
  return actorIdx <= minIdx;
}

// Mirrors backend/src/routes/people.ts's CREATABLE_BY exactly (a
// documented judgment call there, home/docs/dev.md: only the owner may
// create another owner or an admin, so an admin can never mint a peer).
// This is a real, acknowledged "one definition, one place" risk: nothing
// links the two copies, and the backend's is the actual authority - a
// role rejected here would just mean the picker offered something the
// server then 403s with a real error message, never a security gap,
// since the server re-checks this on every POST regardless of what the
// picker shows. A capabilities endpoint ("what can I create") would
// remove the duplication; none exists yet (deferred, docs/dev.md).
const CREATABLE_BY: Record<Role, Role[]> = {
  owner: ["owner", "admin", "adult", "teen", "child", "guest"],
  admin: ["adult", "teen", "child", "guest"],
  adult: [],
  teen: [],
  child: [],
  guest: [],
};

export function creatableRoles(actorRole: Role): Role[] {
  return CREATABLE_BY[actorRole] ?? [];
}

export function canManagePeople(actorRole: Role): boolean {
  return creatableRoles(actorRole).length > 0;
}

// 4.1: an owner or admin profile requires a secret (a PIN-free owner/
// admin is a one-request takeover for anyone who can reach the API) -
// matches routes/people.ts's own check exactly. Shares the real
// definition (backend/src/wire.ts's isOwnerOrAdminRole) with
// backend/src/lib/access.ts's isOwnerOrAdmin and with
// SettingsPage.tsx's backups gate, rather than a third hand-copy of the
// same expression (a code review, 2026-09-04, found exactly that).
export function requiresSecret(role: Role): boolean {
  return isOwnerOrAdminRole(role);
}


/** Who each role may edit or delete. Mirrors
 * backend/src/lib/personLifecycle.ts's MANAGEABLE_BY, which mirrors
 * CREATABLE_BY above, and carries the same acknowledged duplication risk
 * documented there: the server re-checks every one of these on every
 * request, so the worst a wrong answer here can do is show or hide a
 * button, never let something through. */
export function canManagePerson(actorRole: Role, actorId: string, target: { id: string; role: Role }): boolean {
  if (actorId === target.id) return true;
  return creatableRoles(actorRole).includes(target.role);
}

/** Deleting is the same ladder as editing, minus yourself: the backend
 * refuses "you cannot delete your own profile", so offering the button
 * would only produce an error a person cannot act on. */
export function canDeletePerson(actorRole: Role, actorId: string, target: { id: string; role: Role }): boolean {
  if (actorId === target.id) return false;
  return creatableRoles(actorRole).includes(target.role);
}

// `Person.accent`'s six named swatches (spec-v0.1.43) to the matching
// `--profile-accent-*` token (ui-v0.5.68's tokens.css), one definition
// shared by NextPeoplePage.tsx's card grid and PersonProfilePage.tsx's
// header card/Edit dialog - a code review on PEOPLE-GRID-01 would have
// flagged a second hand-copy of this exact map. Literal Tailwind
// arbitrary-value classes, the same lookup-map-of-literals pattern the
// kit's own HeaderPicker.tsx/FooterBar.tsx use for their hue tokens -
// there is no `@theme inline` bridge for these (per-person, not a fixed
// palette a utility class could name).
export const ACCENT_RING_CLASS: Record<Accent, string> = {
  blue: "ring-[var(--profile-accent-blue)]",
  violet: "ring-[var(--profile-accent-violet)]",
  teal: "ring-[var(--profile-accent-teal)]",
  orange: "ring-[var(--profile-accent-orange)]",
  pink: "ring-[var(--profile-accent-pink)]",
  red: "ring-[var(--profile-accent-red)]",
};

export const ACCENT_LABELS: Record<Accent, string> = {
  blue: "Blue",
  violet: "Violet",
  teal: "Teal",
  orange: "Orange",
  pink: "Pink",
  red: "Red",
};

/** `Select` (the primitives wrapper) refuses "" as a real option value
 * (its own header comment: an empty string reads as "unset" to Radix and
 * shows a blank trigger) - "none" is the real, named sentinel for "no
 * accent", mapped to/from `null` at the edges by the Edit dialog, never
 * passed to the API or the swatch maps above. */
export const NO_ACCENT = "none" as const;
export const ACCENT_SELECT_OPTIONS: readonly string[] = [NO_ACCENT, ...(Object.keys(ACCENT_LABELS) as Accent[])];
export const ACCENT_SELECT_LABELS: Record<string, string> = { [NO_ACCENT]: "No accent", ...ACCENT_LABELS };
