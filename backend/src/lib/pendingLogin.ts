import { createHash, randomBytes } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;
type Entry = { personId: string; expiresAt: number };
const pending = new Map<string, Entry>();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

function sweep(now = Date.now()) {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}

export function issuePendingLogin(personId: string): string {
  sweep();
  const token = randomBytes(32).toString("base64url");
  pending.set(digest(token), { personId, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumePendingLogin(token: string): string | null {
  const personId = getPendingLoginPerson(token);
  if (personId) pending.delete(digest(token));
  return personId;
}

export function getPendingLoginPerson(token: string): string | null {
  sweep();
  const key = digest(token);
  const entry = pending.get(key);
  if (!entry) return null;
  return entry.personId;
}

export function __resetPendingLoginsForTests() { pending.clear(); }
export function __pendingLoginTtlForTests() { return TTL_MS; }
