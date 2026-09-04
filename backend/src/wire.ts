import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { conversationTurns } from "./db/schema";

// The wire shapes a browser client needs, kept alias-free (relative
// imports only, never "@/...") so frontend/src/lib/api.ts can import this
// file directly through the @maipai/home-backend workspace dependency:
// backend's own tsconfig "@/*" path mapping does not apply when frontend's
// tsc resolves a file pulled in from another package (a code review,
// 2026-09-04, caught this exact mirror-can-drift risk when these three
// shapes were still hand-duplicated in api.ts; the first fix attempt
// re-exported the real files directly and failed to typecheck for
// exactly this reason). turnEngine.ts, conversationHistory.ts, and
// personShape.ts re-export from here rather than defining these inline,
// so there is still exactly one definition, just relocated to the one
// file both a "@/"-aliased backend module and an external package can
// both resolve.

export type Roster = Omit<Person, "birthdate"> & { hasSecret: boolean };

export interface TurnReply {
  text: string;
  speech?: string;
}

export interface TurnValue {
  reply: TurnReply;
  source: "safety_refuse" | "skill" | "skill_error" | "model";
  skill_id?: string;
  safety: SafetyResult;
  /** 4.3: "offer, never block." Set only on allow_with_resources, kept
   * separate from `reply` so a surface can present it alongside the
   * answer rather than have it silently reshape the model's own words. */
  crisis_resources?: string;
}

export type ConversationTurnRow = typeof conversationTurns.$inferSelect;

export interface ResolvedSetting {
  key: string;
  value: unknown;
  source: "user" | "default" | "package" | "sync";
  label: string;
  help?: string;
  level: "basic" | "advanced" | "expert";
  secret: boolean;
  /** Only meaningful when secret is true: whether a real value has been
   * stored, without ever revealing it (lib/settings.ts's resolveForResponse). */
  isSet?: boolean;
}

export interface BackupInfo {
  filename: string;
  createdAt: string;
  bytes: number;
}

// The role-string half of lib/access.ts's isOwnerOrAdmin(actor: PersonRow):
// that function takes a full PersonRow (an "@/types" dependency this file
// can't have), so this is the underlying string check, shared for real
// with a frontend client instead of being hand-copied a third time. A
// code review (2026-09-04) found frontend/src/apps/settings/SettingsPage.tsx
// had grown its own inline `role === "owner" || role === "admin"` on top
// of frontend/src/apps/people/roles.ts's requiresSecret doing the
// identical check for an unrelated reason - both now call this.
export function isOwnerOrAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}
