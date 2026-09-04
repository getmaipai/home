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
