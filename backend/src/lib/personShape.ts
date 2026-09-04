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
