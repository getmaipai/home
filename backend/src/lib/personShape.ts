import { Person } from "@maipai/spec/gen/ts/person.js";
import type { PersonRow } from "@/types";

// Drizzle's row shape is camelCase (JS convention); home/spec/schemas/
// person.schema.json is snake_case (the shared shape hub and robot both
// read and write). Every response that hands a person back over the API
// goes through here, which both converts AND validates: parsing through
// the generated Zod schema means an API response can never silently drift
// from the spec (tests/auth.test.ts and tests/people.test.ts assert this).
export function toPerson(row: PersonRow): Person {
  return Person.parse({
    id: row.id,
    display_name: row.displayName,
    nickname: row.nickname,
    birthdate: row.birthdate,
    role: row.role,
    avatar_seed: row.avatarSeed,
    source: row.source,
    local_only: row.localOnly,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  });
}

// The household roster shape: a Person with birthdate left out. 3.1 and
// 4.2: birthdate is core-only, packages and API clients only ever see
// age_range (derived server-side; age-band derivation itself is a later
// hub release, see docs/dev.md).
export function toRoster(row: PersonRow): Omit<Person, "birthdate"> {
  const { birthdate: _birthdate, ...roster } = toPerson(row);
  return roster;
}

// The other direction: validate a candidate Person BEFORE it reaches
// SQLite, the same discipline lib/memory.ts's remember() already uses. A
// code review (2026-09-04) found routes/people.ts inserting
// client-supplied birthdate/avatarSeed straight into the table with only
// ad hoc length checks, so an invalid birthdate corrupted the row and
// then crashed toRoster()'s Person.parse() on every later read of the
// whole roster (not just that request). safeParse here means a bad
// candidate is rejected before any write happens.
export function parsePersonCandidate(candidate: unknown) {
  return Person.safeParse(candidate);
}

export function personToDbValues(person: Person) {
  return {
    id: person.id,
    displayName: person.display_name,
    nickname: person.nickname,
    birthdate: person.birthdate,
    role: person.role,
    avatarSeed: person.avatar_seed,
    source: person.source,
    localOnly: person.local_only,
    createdAt: person.created_at,
    updatedAt: person.updated_at,
    deletedAt: person.deleted_at,
  };
}
