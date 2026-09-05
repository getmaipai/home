// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/entity.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**
 * Anything the household knows about and can refer to: a person, a pet, a place, an organization, a thing. One table, one id space, discriminated by `kind`, so a relationship can point at any two of them without a polymorphic join.
 *
 * An Entity is NOT an account. A Person record (person.schema.json) is the account-bearing half of a `kind: person` entity, linked by `account_person_id`: grandma who is only ever mentioned in conversation and grandma who signs in are the same entity at different stages, which is the whole reason this shape exists.
 *
 * This also replaces the free-text `record_kind: entity` memory record as the household's notion of a named thing. That record kept a name and a description in one `text` field by convention ('Name: description'), recovered by splitting on the first colon, which lib/memory.ts documents as an approximation. Memory stays narrative ('Bramble likes trains'); entities and the facts joining them live here, structured.
 */
export const Entity = z
  .object({
    /**Stable id, never reused, even after deleted_at is set. Distinct from the `ent<seq>-<device6>` ids memory records use for their own entity rows; those are memory rows, these are entities.*/
    id: z
      .string()
      .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
      .describe(
        "Stable id, never reused, even after deleted_at is set. Distinct from the `ent<seq>-<device6>` ids memory records use for their own entity rows; those are memory rows, these are entities.",
      ),
    /**A closed set on purpose. A new kind is a spec change with a migration, not a free-text value a package can invent, because every relationship type declares which kinds it may join.*/
    kind: z
      .enum(["person", "pet", "place", "organization", "thing"])
      .describe(
        "A closed set on purpose. A new kind is a spec change with a migration, not a free-text value a package can invent, because every relationship type declares which kinds it may join.",
      ),
    /**What the household calls this. A real field, not a parsed prefix.*/
    name: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "What the household calls this. A real field, not a parsed prefix.",
      ),
    /**Other names the same entity answers to ('Mum', 'Grandma Iris', 'the vet'). Entity-first recall matches on these too, which is what the legacy hub's entities table indexed and the free-text memory entity could not.*/
    aliases: z
      .array(z.string().min(1).max(200))
      .describe(
        "Other names the same entity answers to ('Mum', 'Grandma Iris', 'the vet'). Entity-first recall matches on these too, which is what the legacy hub's entities table indexed and the free-text memory entity could not.",
      )
      .default([]),
    /**Free text about the entity itself. Facts that join it to another entity belong in a Relationship, not here.*/
    description: z
      .union([
        z
          .string()
          .max(2000)
          .describe(
            "Free text about the entity itself. Facts that join it to another entity belong in a Relationship, not here.",
          ),
        z
          .null()
          .describe(
            "Free text about the entity itself. Facts that join it to another entity belong in a Relationship, not here.",
          ),
      ])
      .describe(
        "Free text about the entity itself. Facts that join it to another entity belong in a Relationship, not here.",
      )
      .default(null),
    /**Only meaningful when kind is `place`, required then. `map` is a place on a map (a home, a workplace, a school) - Home Assistant calls this a zone. `area` is a space inside a place (a room) - Home Assistant calls this an area. Keeping both senses in one kind with a subtype, rather than two kinds, is a documented judgment call (home/docs/dev.md): a room and a house are both places you can be, and every relationship that points at one can point at the other. Cross-field rules like this one are enforced by spec/records/ts/validate.ts and its tests, not by this schema: neither generator preserves JSON Schema conditionals, so an if/then here would look enforced and do nothing. Same convention MemoryRecord already follows for its own scope/person rule.*/
    place_kind: z
      .union([z.literal("map"), z.literal("area"), z.literal(null)])
      .describe(
        "Only meaningful when kind is `place`, required then. `map` is a place on a map (a home, a workplace, a school) - Home Assistant calls this a zone. `area` is a space inside a place (a room) - Home Assistant calls this an area. Keeping both senses in one kind with a subtype, rather than two kinds, is a documented judgment call (home/docs/dev.md): a room and a house are both places you can be, and every relationship that points at one can point at the other. Cross-field rules like this one are enforced by spec/records/ts/validate.ts and its tests, not by this schema: neither generator preserves JSON Schema conditionals, so an if/then here would look enforced and do nothing. Same convention MemoryRecord already follows for its own scope/person rule.",
      )
      .default(null),
    /**Physical containment only, and only for places: a room's home, a home's... nothing yet. Exactly one parent, mirroring Home Assistant's rule that an entity belongs to one area. Every other kind of belonging is a Relationship, which is many-to-many and carries time.*/
    parent_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
          .describe(
            "Physical containment only, and only for places: a room's home, a home's... nothing yet. Exactly one parent, mirroring Home Assistant's rule that an entity belongs to one area. Every other kind of belonging is a Relationship, which is many-to-many and carries time.",
          ),
        z
          .null()
          .describe(
            "Physical containment only, and only for places: a room's home, a home's... nothing yet. Exactly one parent, mirroring Home Assistant's rule that an entity belongs to one area. Every other kind of belonging is a Relationship, which is many-to-many and carries time.",
          ),
      ])
      .describe(
        "Physical containment only, and only for places: a room's home, a home's... nothing yet. Exactly one parent, mirroring Home Assistant's rule that an entity belongs to one area. Every other kind of belonging is a Relationship, which is many-to-many and carries time.",
      )
      .default(null),
    /**The Person record that signs in as this entity, when there is one. Only valid on kind: person. Absent means someone the household knows about but who has no account, which is the normal case for most people a family talks about. Enforced in validate.ts.*/
    account_person_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "The Person record that signs in as this entity, when there is one. Only valid on kind: person. Absent means someone the household knows about but who has no account, which is the normal case for most people a family talks about. Enforced in validate.ts.",
          ),
        z
          .null()
          .describe(
            "The Person record that signs in as this entity, when there is one. Only valid on kind: person. Absent means someone the household knows about but who has no account, which is the normal case for most people a family talks about. Enforced in validate.ts.",
          ),
      ])
      .describe(
        "The Person record that signs in as this entity, when there is one. Only valid on kind: person. Absent means someone the household knows about but who has no account, which is the normal case for most people a family talks about. Enforced in validate.ts.",
      )
      .default(null),
    /**Where this entity came from. `inferred` means the hub created it from conversation and no person has confirmed it exists; see Relationship's own confidence rules, which apply here for the same reason.*/
    source: z
      .enum(["hub", "local", "imported", "inferred"])
      .describe(
        "Where this entity came from. `inferred` means the hub created it from conversation and no person has confirmed it exists; see Relationship's own confidence rules, which apply here for the same reason.",
      ),
    /**Who confirmed this entity is real, and when that has happened. Meaningful mainly for `source: inferred`, which starts unconfirmed and is never stated as fact to anyone until this is set; an entity a person created through the UI (`source: hub`) is confirmed by the act of creating it, and records who. An earlier draft said 'null while source is inferred', which was self-contradictory - if it must stay null there is no way for a guess to ever become assertable (code review, 2026-09-05).*/
    confirmed_by_person_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Who confirmed this entity is real, and when that has happened. Meaningful mainly for `source: inferred`, which starts unconfirmed and is never stated as fact to anyone until this is set; an entity a person created through the UI (`source: hub`) is confirmed by the act of creating it, and records who. An earlier draft said 'null while source is inferred', which was self-contradictory - if it must stay null there is no way for a guess to ever become assertable (code review, 2026-09-05).",
          ),
        z
          .null()
          .describe(
            "Who confirmed this entity is real, and when that has happened. Meaningful mainly for `source: inferred`, which starts unconfirmed and is never stated as fact to anyone until this is set; an entity a person created through the UI (`source: hub`) is confirmed by the act of creating it, and records who. An earlier draft said 'null while source is inferred', which was self-contradictory - if it must stay null there is no way for a guess to ever become assertable (code review, 2026-09-05).",
          ),
      ])
      .describe(
        "Who confirmed this entity is real, and when that has happened. Meaningful mainly for `source: inferred`, which starts unconfirmed and is never stated as fact to anyone until this is set; an entity a person created through the UI (`source: hub`) is confirmed by the act of creating it, and records who. An earlier draft said 'null while source is inferred', which was self-contradictory - if it must stay null there is no way for a guess to ever become assertable (code review, 2026-09-05).",
      )
      .default(null),
    /**Who this entity is visible to, following memory-record.schema.json's scoping, minus its `self` value: `self` is the companion's own memory of itself, which an entity in the household's graph never is. A person mentioned only in one person's conversations is theirs, not the household's; pooling it is the failure the org's per-person identity rule exists to prevent.*/
    scope: z
      .enum(["household", "person"])
      .describe(
        "Who this entity is visible to, following memory-record.schema.json's scoping, minus its `self` value: `self` is the companion's own memory of itself, which an entity in the household's graph never is. A person mentioned only in one person's conversations is theirs, not the household's; pooling it is the failure the org's per-person identity rule exists to prevent.",
      )
      .default("household"),
    /**Required when scope is person; null for household scope. Same field and same rule as MemoryRecord. Enforced in validate.ts.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Required when scope is person; null for household scope. Same field and same rule as MemoryRecord. Enforced in validate.ts.",
          ),
        z
          .null()
          .describe(
            "Required when scope is person; null for household scope. Same field and same rule as MemoryRecord. Enforced in validate.ts.",
          ),
      ])
      .describe(
        "Required when scope is person; null for household scope. Same field and same rule as MemoryRecord. Enforced in validate.ts.",
      )
      .default(null),
    /**Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone. Same meaning as MemoryRecord.sensitive.*/
    sensitive: z
      .boolean()
      .describe(
        "Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone. Same meaning as MemoryRecord.sensitive.",
      )
      .default(false),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    /**A tombstone, not a removal: a row that simply vanishes is indistinguishable to a robot syncing later from one it has not been told about yet.*/
    deleted_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "A tombstone, not a removal: a row that simply vanishes is indistinguishable to a robot syncing later from one it has not been told about yet.",
          ),
        z
          .null()
          .describe(
            "A tombstone, not a removal: a row that simply vanishes is indistinguishable to a robot syncing later from one it has not been told about yet.",
          ),
      ])
      .describe(
        "A tombstone, not a removal: a row that simply vanishes is indistinguishable to a robot syncing later from one it has not been told about yet.",
      )
      .default(null),
  })
  .strict()
  .describe(
    "Anything the household knows about and can refer to: a person, a pet, a place, an organization, a thing. One table, one id space, discriminated by `kind`, so a relationship can point at any two of them without a polymorphic join.\n\nAn Entity is NOT an account. A Person record (person.schema.json) is the account-bearing half of a `kind: person` entity, linked by `account_person_id`: grandma who is only ever mentioned in conversation and grandma who signs in are the same entity at different stages, which is the whole reason this shape exists.\n\nThis also replaces the free-text `record_kind: entity` memory record as the household's notion of a named thing. That record kept a name and a description in one `text` field by convention ('Name: description'), recovered by splitting on the first colon, which lib/memory.ts documents as an approximation. Memory stays narrative ('Bramble likes trains'); entities and the facts joining them live here, structured.",
  );
export type Entity = z.infer<typeof Entity>;
