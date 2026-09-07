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

/** Matches spec/schemas/entity.schema.json's `^ent-[a-z0-9]{6,}$`.
 * Distinct from the `ent<seq>-<device6>` ids memory records mint for
 * their own entity-mention rows (lib/memoryId.ts) - those are memory
 * rows, these are step 7's structured Entity records. */
export function newEntityId(): string {
  return `ent-${randomSuffix(10)}`;
}

/** Matches spec/schemas/relationship.schema.json's `^rel-[a-z0-9]{6,}$`. */
export function newRelationshipId(): string {
  return `rel-${randomSuffix(10)}`;
}

/** Matches spec/schemas/grant.schema.json's `^grant-[a-z0-9]{6,}$`. */
export function newGrantId(): string {
  return `grant-${randomSuffix(10)}`;
}

// Not a spec-shaped id (the approval queue is hub-internal, the same
// reason scheduledJobs/commands/issues are).
export function newApprovalId(): string {
  return `approval-${randomSuffix(10)}`;
}

// Not a spec-shaped id (received_backups is hub-internal, the same
// reason scheduledJobs/commands/issues are).
export function newReceivedBackupId(): string {
  return `recvbak-${randomSuffix(10)}`;
}

/** Matches spec/schemas/list.schema.json's `^list-[a-z0-9]{6,}$`. */
export function newListId(): string {
  return `list-${randomSuffix(10)}`;
}

/** Matches spec/schemas/list.schema.json's own item `^item-[a-z0-9]{6,}$`. */
export function newListItemId(): string {
  return `item-${randomSuffix(10)}`;
}

// Not a spec-shaped id (nas_mounts is hub-internal, declaration only -
// see db/schema.ts's own comment).
export function newNasMountId(): string {
  return `nasmount-${randomSuffix(10)}`;
}
