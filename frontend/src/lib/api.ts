import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import type {
  Roster,
  TurnValue,
  ConversationTurnRow,
  ResolvedSetting,
  BackupInfo,
} from "@maipai/home-backend/src/wire";
import { isOwnerOrAdminRole } from "@maipai/home-backend/src/wire";

// GET /api/people (routes/people.ts) returns toRoster()'s output directly
// - the same Omit<Person, "birthdate"> shape Roster wraps, minus
// Roster's own hasSecret (that field only exists on /api/auth/profiles'
// response, added by that route, not toRoster() itself). Derived from
// the real spec type rather than hand-listing fields again.
export type PersonRosterEntry = Omit<Person, "birthdate">;
export type Role = Person["role"];

// Real backend types, imported from @/wire (not hand-duplicated): a code
// review (2026-09-04) flagged an earlier version of this file for
// hand-typing mirrors of these three, which could silently drift from the
// real shapes since nothing linked them. Importing turnEngine.ts or
// conversationHistory.ts directly instead of @/wire does not work here:
// those files (and personShape.ts) pull in backend's own "@/..." path
// aliases, which frontend's tsconfig has no mapping for - @/wire exists
// specifically because it has no such imports. frontend/package.json
// depends on @maipai/home-backend as a workspace package for this;
// re-export the types here so the rest of the frontend imports from one
// place.
export type { Roster, TurnValue, ConversationTurnRow, ResolvedSetting, BackupInfo };
export { isOwnerOrAdminRole };
// SettingsKey is spec-generated (@maipai/spec), not backend-only, so it's
// imported directly rather than through @/wire.
export type { SettingsKey };
// SafetyResult flows through TurnValue.safety; re-exported for callers
// that want it by name without reaching into @maipai/spec directly.
export type { SafetyResult };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

// Every request is same-origin (Vite's dev proxy in dev, backend's own
// serveStatic in prod: vite.config.ts and app.ts) with the session
// cookie included: there is no header-based auth path at all
// (middleware/auth.ts), so `credentials: "include"` is not optional.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  }
  return body as T;
}

export const api = {
  profiles: () => request<Roster[]>("/api/auth/profiles"),
  setup: (displayName: string, secret: string) =>
    request<{ person: unknown }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ displayName, secret }),
    }),
  select: (personId: string) =>
    request<{ success: true }>("/api/auth/select", {
      method: "POST",
      body: JSON.stringify({ personId }),
    }),
  verifySecret: (personId: string, secret: string) =>
    request<{ success: true }>("/api/auth/verify-secret", {
      method: "POST",
      body: JSON.stringify({ personId, secret }),
    }),
  me: () => request<Roster>("/api/auth/me"),
  logout: () => request<{ success: true }>("/api/auth/logout", { method: "POST" }),
  conversations: () => request<ConversationTurnRow[]>("/api/conversations"),
  sendTurn: (text: string) =>
    request<TurnValue>("/api/turn", {
      method: "POST",
      body: JSON.stringify({ surface: "chat", text }),
    }),
  settingsRegistry: () => request<SettingsKey[]>("/api/settings/registry"),
  settingsValues: (scope: string) =>
    request<ResolvedSetting[]>(`/api/settings?scope=${encodeURIComponent(scope)}`),
  setSetting: (scope: string, key: string, value: unknown) =>
    request<ResolvedSetting>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ scope, key, value }),
    }),
  resetSetting: (scope: string, key: string) =>
    request<ResolvedSetting>("/api/settings/reset", {
      method: "POST",
      body: JSON.stringify({ scope, key }),
    }),
  people: () => request<PersonRosterEntry[]>("/api/people"),
  createPerson: (input: { displayName: string; role: Role; secret?: string }) =>
    request<PersonRosterEntry>("/api/people", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  backups: () => request<BackupInfo[]>("/api/backups"),
  runBackup: () => request<BackupInfo>("/api/backups/run", { method: "POST" }),
};
