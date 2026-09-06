// Quick Connect: sign a TV in with a short code instead of typing a
// password on a remote. Jellyfin's Quick Connect and every streaming
// app's "enter this code" flow, pointed at our own sign-in. Ported from
// the archived legacy hub's lib/quickConnect.ts (principle 8: hard-won
// logic, reused).
//
// Flow: the TV asks for a code (POST /api/auth/quick-connect/code) and
// gets back `{ code, poll_token }` - two different secrets, not one. The
// code is what a human reads off the TV screen and types on their phone
// to approve; poll_token is known only to the TV that requested it. A
// code alone can't redeem the resulting session - someone who merely
// shoulder-surfs the code off the screen cannot poll and steal the
// session meant for the TV before the TV itself does. The TV polls (GET
// /api/auth/quick-connect/poll) with its poll_token; a signed-in phone
// approves with just the code (POST /api/auth/quick-connect/approve).
//
// In-memory on purpose (the same reasoning drop presence and
// watch-together used): a pending login is worthless after a restart,
// and codes expire in five minutes anyway.
import { randomInt } from "node:crypto";
import { tryConsume } from "@/lib/rateLimiter";
import type { DeviceKind } from "@/lib/devices";

export interface QuickConnectRequest {
  code: string;
  pollToken: string;
  /** Set once someone approves; the device's next poll then mints a session for them. */
  approvedPersonId: string | null;
  /** Human label for the approval prompt ("Living room TV"). */
  label: string;
  kind: DeviceKind;
  createdAt: number;
  expiresAt: number;
  /** True once a session has been minted, so a code can never be redeemed twice. */
  consumed: boolean;
}

const TTL_MS = 5 * 60_000;
const requestsByCode = new Map<string, QuickConnectRequest>();
const requestsByPollToken = new Map<string, QuickConnectRequest>();

// No 0/O/1/I: these get read aloud across a room off a TV screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function newPollToken(): string {
  // Not human-facing (never shown, never typed), so no readability
  // constraint - a wide alphanumeric alphabet keeps it short and
  // collision-resistant.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function sweep(): void {
  const now = Date.now();
  for (const [code, r] of requestsByCode) {
    if (r.expiresAt < now) {
      requestsByCode.delete(code);
      requestsByPollToken.delete(r.pollToken);
    }
  }
}

// A code review of the legacy version's own history (docs/BACKLOG.md:
// "`/pair` had no limiter") flagged this class of endpoint as needing
// one; wave-2's contract keeps Quick Connect a separate flow from any
// future generic pairing route, so the limiter lives here rather than
// waiting for that route to exist. Keyed globally (not per-IP): a code
// is meant to be requested a handful of times per real device setup,
// never in a tight loop, regardless of which address it comes from.
const CODE_RATE_LIMIT = { capacity: 20, refillPerSecond: 0.2 };

/** Start a login: the caller shows this code and polls with its own
 * poll_token until approved. Returns null if the rate limit is hit. */
export function createQuickConnect(label: string, kind: DeviceKind): QuickConnectRequest | null {
  if (!tryConsume("quick-connect:create", CODE_RATE_LIMIT)) return null;
  sweep();
  let code = newCode();
  while (requestsByCode.has(code)) code = newCode();
  const pollToken = newPollToken();
  const now = Date.now();
  const req: QuickConnectRequest = {
    code,
    pollToken,
    approvedPersonId: null,
    label: label.trim().slice(0, 60) || "A device",
    kind,
    createdAt: now,
    expiresAt: now + TTL_MS,
    consumed: false,
  };
  requestsByCode.set(code, req);
  requestsByPollToken.set(pollToken, req);
  return req;
}

function getByCode(code: string): QuickConnectRequest | null {
  sweep();
  return requestsByCode.get(code.trim().toUpperCase()) ?? null;
}

function getByPollToken(pollToken: string): QuickConnectRequest | null {
  sweep();
  return requestsByPollToken.get(pollToken) ?? null;
}

/** Approve a code as `personId`. False for unknown/expired/already-approved
 * codes - the approving phone gets an honest "that code's no longer
 * valid" rather than silently doing nothing. */
export function approveQuickConnect(code: string, personId: string): boolean {
  if (!tryConsume("quick-connect:approve", CODE_RATE_LIMIT)) return false;
  const req = getByCode(code);
  if (!req || req.approvedPersonId || req.consumed) return false;
  req.approvedPersonId = personId;
  return true;
}

/** The waiting device polls with its poll_token, exactly once claiming
 * the approval. Null for unknown/expired/not-yet-approved/already-claimed. */
export function consumeQuickConnect(pollToken: string): { personId: string; kind: DeviceKind; label: string } | null {
  if (!tryConsume("quick-connect:poll", CODE_RATE_LIMIT)) return null;
  const req = getByPollToken(pollToken);
  if (!req || !req.approvedPersonId || req.consumed) return null;
  req.consumed = true;
  return { personId: req.approvedPersonId, kind: req.kind, label: req.label };
}

/** True while a poll_token's request is still pending approval - lets the
 * device tell "still waiting" apart from "expired or unknown" without
 * exposing anything about the code itself. */
export function isQuickConnectPending(pollToken: string): boolean {
  const req = getByPollToken(pollToken);
  return !!req && !req.approvedPersonId && !req.consumed;
}

/** Test-only: forgets every pending request. */
export function __resetQuickConnectForTests(): void {
  requestsByCode.clear();
  requestsByPollToken.clear();
}
