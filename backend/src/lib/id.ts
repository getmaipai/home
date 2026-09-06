import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Exported so lib/deviceId.ts doesn't hand-roll the same "random base36
// string from crypto bytes" loop a second time (a code review,
// 2026-09-04, found it had).
export function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Matches spec/schemas/person.schema.json's `^person-[a-z0-9]{6,}$`. */
export function newPersonId(): string {
  return `person-${randomSuffix(10)}`;
}

// Not a spec-shaped id (scheduled jobs aren't a spec 3.1 record type,
// see lib/scheduler.ts's header comment for why), so no schema pattern
// to match: just a stable, collision-resistant local id.
export function newJobId(): string {
  return `job-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (conversation turns aren't a spec 3.1
// record type, see lib/conversationHistory.ts's header comment for why).
export function newConversationTurnId(): string {
  return `turn-${randomSuffix(10)}`;
}

/** Matches spec/schemas/conversation.schema.json's `^conv-[a-z0-9]{6,}$`
 * (session-a-intelligence.md step 3: the conversation THREAD is a real
 * spec-shaped record, unlike the turn id above). */
export function newConversationId(): string {
  return `conv-${randomSuffix(10)}`;
}

// Not a spec-shaped id either. Longer than the other ids here (16 chars,
// ~83 bits, vs. their 10/~52) on purpose: this one doubles as a bearer
// capability for routes/voice.ts's unauthenticated `GET /cloned/:id/file`
// route (pocket-tts, a separate unauthenticated process, has to fetch it
// by plain URL) - guessing it has to stay implausible, not merely
// unlikely, the same reasoning session.ts's own 32-byte token uses for
// the same class of problem.
export function newClonedVoiceId(): string {
  return `voice-${randomSuffix(16)}`;
}

// Not a spec-shaped id either (commands aren't a spec 3.1 record type,
// see lib/commands.ts's own header for why - the same call scheduledJobs
// already made).
export function newCommandId(): string {
  return `cmd-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (a delivered notification is hub-internal
// for the same reason scheduledJobs/commands are - see
// lib/notifications.ts's own header).
export function newNotificationId(): string {
  return `notif-${randomSuffix(10)}`;
}

/** Matches spec/schemas/issue.schema.json's `^issue-[a-z0-9]{6,}$`. */
export function newIssueId(): string {
  return `issue-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (a managed hub-endpoint row is hub-
// internal, the same reason db/schema.ts's hubEndpoints table comment
// gives).
export function newEndpointId(): string {
  return `endpoint-${randomSuffix(10)}`;
}

/** Matches spec/schemas/device.schema.json's `^device-[a-z0-9]{6,}$`. */
export function newDeviceId(): string {
  return `device-${randomSuffix(10)}`;
}

// Not a spec-shaped id (a device token row is hub-internal - the token
// itself, not its id, is what a client ever sees, and only as a raw
// secret returned once, never a persisted identifier).
export function newDeviceTokenId(): string {
  return `devtok-${randomSuffix(10)}`;
}
