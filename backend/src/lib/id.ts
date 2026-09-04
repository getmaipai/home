import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
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
