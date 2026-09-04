import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { Roster, TurnValue, ConversationTurnRow } from "@maipai/home-backend/src/wire";

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
export type { Roster, TurnValue, ConversationTurnRow };
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
};
