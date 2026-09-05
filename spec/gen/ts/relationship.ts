// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/relationship.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**
 * A typed, directed edge between two entities: who is whose parent, who owns the dog, who lives where, who works where. One mechanism for every kind of connection, so ownership, residence, employment and family are not four systems.
 *
 * Two axes, deliberately not collapsed into one (Jesse, 2026-09-05, from two real examples). `valid_from`/`valid_to` answer whether the relationship holds AT ALL: a former job has valid_to set. `status` answers what KIND of true it is: an estranged daughter has valid_to null, because she is still his daughter, and status `estranged`. Fold those together and you get either an 'ex-daughter' or a former job that still reads as current.
 *
 * The payoff is not the data, it is that a renderer can say 'Jesse's former job at Acme' rather than 'Jesse's job at Acme', and never says 'your boyfriend Alex' three weeks after a breakup. Free-text memory cannot reliably supply that tense today.
 *
 * This is NOT an authorization edge. See grant.schema.json.
 */
export const Relationship = z
  .object({
    id: z.string().regex(new RegExp("^rel-[a-z0-9]{6,}$")),
    /**One of spec/vocab/relationship-types.json's ids. The vocabulary declares which entity kinds this type may join, whether it is terminable, and which statuses it admits; a value outside it is rejected, the same way an unknown permission or capability is.*/
    type: z
      .string()
      .min(1)
      .describe(
        "One of spec/vocab/relationship-types.json's ids. The vocabulary declares which entity kinds this type may join, whether it is terminable, and which statuses it admits; a value outside it is rejected, the same way an unknown permission or capability is.",
      ),
    /**The subject. Direction matters: parent_of and child_of are different edges, both stored, so a lookup either way is an index hit rather than a scan.*/
    from_id: z
      .string()
      .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
      .describe(
        "The subject. Direction matters: parent_of and child_of are different edges, both stored, so a lookup either way is an index hit rather than a scan.",
      ),
    /**The object.*/
    to_id: z
      .string()
      .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
      .describe("The object."),
    /**One of the statuses the vocabulary allows for this type. Never a substitute for valid_to.*/
    status: z
      .string()
      .describe(
        "One of the statuses the vocabulary allows for this type. Never a substitute for valid_to.",
      ),
    /**When this became true, if known. Null means 'as long as anyone has said', not 'never'.*/
    valid_from: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When this became true, if known. Null means 'as long as anyone has said', not 'never'.",
          ),
        z
          .null()
          .describe(
            "When this became true, if known. Null means 'as long as anyone has said', not 'never'.",
          ),
      ])
      .describe(
        "When this became true, if known. Null means 'as long as anyone has said', not 'never'.",
      )
      .default(null),
    /**When this stopped being true. Null means it still holds. Only permitted on types the vocabulary marks terminable: setting it on parent_of would assert an ex-daughter. Distinct from expired_at, exactly as MemoryRecord distinguishes them: this is about the world, that is about our record of it. Whether a type may set it at all comes from the vocabulary, checked in validate.ts.*/
    valid_to: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When this stopped being true. Null means it still holds. Only permitted on types the vocabulary marks terminable: setting it on parent_of would assert an ex-daughter. Distinct from expired_at, exactly as MemoryRecord distinguishes them: this is about the world, that is about our record of it. Whether a type may set it at all comes from the vocabulary, checked in validate.ts.",
          ),
        z
          .null()
          .describe(
            "When this stopped being true. Null means it still holds. Only permitted on types the vocabulary marks terminable: setting it on parent_of would assert an ex-daughter. Distinct from expired_at, exactly as MemoryRecord distinguishes them: this is about the world, that is about our record of it. Whether a type may set it at all comes from the vocabulary, checked in validate.ts.",
          ),
      ])
      .describe(
        "When this stopped being true. Null means it still holds. Only permitted on types the vocabulary marks terminable: setting it on parent_of would assert an ex-daughter. Distinct from expired_at, exactly as MemoryRecord distinguishes them: this is about the world, that is about our record of it. Whether a type may set it at all comes from the vocabulary, checked in validate.ts.",
      )
      .default(null),
    /**When WE retired this record, as opposed to when the fact stopped being true. Same bitemporal split MemoryRecord already uses.*/
    expired_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When WE retired this record, as opposed to when the fact stopped being true. Same bitemporal split MemoryRecord already uses.",
          ),
        z
          .null()
          .describe(
            "When WE retired this record, as opposed to when the fact stopped being true. Same bitemporal split MemoryRecord already uses.",
          ),
      ])
      .describe(
        "When WE retired this record, as opposed to when the fact stopped being true. Same bitemporal split MemoryRecord already uses.",
      )
      .default(null),
    /**`stated` means a person in the household said so. `inferred` means the hub worked it out from conversation and nobody has confirmed it. The difference is load-bearing: an inferred relationship is never spoken as fact, and inference is what makes this record type dangerous rather than merely useful.*/
    source: z
      .enum(["stated", "imported", "inferred"])
      .describe(
        "`stated` means a person in the household said so. `inferred` means the hub worked it out from conversation and nobody has confirmed it. The difference is load-bearing: an inferred relationship is never spoken as fact, and inference is what makes this record type dangerous rather than merely useful.",
      ),
    /**Who said so, when source is `stated`. Provenance for a fact about someone's family is not optional.*/
    stated_by_person_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Who said so, when source is `stated`. Provenance for a fact about someone's family is not optional.",
          ),
        z
          .null()
          .describe(
            "Who said so, when source is `stated`. Provenance for a fact about someone's family is not optional.",
          ),
      ])
      .describe(
        "Who said so, when source is `stated`. Provenance for a fact about someone's family is not optional.",
      )
      .default(null),
    /**Only meaningful when source is `inferred`. A stated relationship has no confidence; a person said it. Enforced in spec/records/ts/validate.ts, not by this schema (no generator preserves conditionals).*/
    confidence: z
      .union([
        z
          .number()
          .gte(0)
          .lte(1)
          .describe(
            "Only meaningful when source is `inferred`. A stated relationship has no confidence; a person said it. Enforced in spec/records/ts/validate.ts, not by this schema (no generator preserves conditionals).",
          ),
        z
          .null()
          .describe(
            "Only meaningful when source is `inferred`. A stated relationship has no confidence; a person said it. Enforced in spec/records/ts/validate.ts, not by this schema (no generator preserves conditionals).",
          ),
      ])
      .describe(
        "Only meaningful when source is `inferred`. A stated relationship has no confidence; a person said it. Enforced in spec/records/ts/validate.ts, not by this schema (no generator preserves conditionals).",
      )
      .default(null),
    /**Who confirmed an inferred relationship. Until this is set, the relationship may be used to ask ('is Alex your partner?') but never asserted ('your partner Alex').*/
    confirmed_by_person_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Who confirmed an inferred relationship. Until this is set, the relationship may be used to ask ('is Alex your partner?') but never asserted ('your partner Alex').",
          ),
        z
          .null()
          .describe(
            "Who confirmed an inferred relationship. Until this is set, the relationship may be used to ask ('is Alex your partner?') but never asserted ('your partner Alex').",
          ),
      ])
      .describe(
        "Who confirmed an inferred relationship. Until this is set, the relationship may be used to ask ('is Alex your partner?') but never asserted ('your partner Alex').",
      )
      .default(null),
    /**What this was inferred from: conversation turn ids, memory record ids, an import job. A machine guess about someone's family that cannot be traced back is not reviewable, and this is the field that makes a wrong one correctable.*/
    evidence: z
      .array(z.string().min(1))
      .describe(
        "What this was inferred from: conversation turn ids, memory record ids, an import job. A machine guess about someone's family that cannot be traced back is not reviewable, and this is the field that makes a wrong one correctable.",
      )
      .default([]),
    /**Who may see this edge. Defaults to `person`, not `household`, and that default is the safety decision in this whole file: a relationship inferred from one person's conversation is THEIR data. A teen mentioning a partner must not become something the household knows because the hub joined two records together. Widening to household is a person's explicit act.*/
    scope: z
      .enum(["household", "person"])
      .describe(
        "Who may see this edge. Defaults to `person`, not `household`, and that default is the safety decision in this whole file: a relationship inferred from one person's conversation is THEIR data. A teen mentioning a partner must not become something the household knows because the hub joined two records together. Widening to household is a person's explicit act.",
      )
      .default("person"),
    /**Required when scope is person; null for household scope. Same field and rule as MemoryRecord and Entity. Enforced in validate.ts.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Required when scope is person; null for household scope. Same field and rule as MemoryRecord and Entity. Enforced in validate.ts.",
          ),
        z
          .null()
          .describe(
            "Required when scope is person; null for household scope. Same field and rule as MemoryRecord and Entity. Enforced in validate.ts.",
          ),
      ])
      .describe(
        "Required when scope is person; null for household scope. Same field and rule as MemoryRecord and Entity. Enforced in validate.ts.",
      )
      .default(null),
    /**Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone. Some relationships are sensitive by their nature regardless of who asked.*/
    sensitive: z
      .boolean()
      .describe(
        "Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone. Some relationships are sensitive by their nature regardless of who asked.",
      )
      .default(false),
    note: z.union([z.string().max(2000), z.null()]).default(null),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    /**A tombstone, for the same sync reason Entity and Person keep one.*/
    deleted_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "A tombstone, for the same sync reason Entity and Person keep one.",
          ),
        z
          .null()
          .describe(
            "A tombstone, for the same sync reason Entity and Person keep one.",
          ),
      ])
      .describe(
        "A tombstone, for the same sync reason Entity and Person keep one.",
      )
      .default(null),
  })
  .strict()
  .describe(
    "A typed, directed edge between two entities: who is whose parent, who owns the dog, who lives where, who works where. One mechanism for every kind of connection, so ownership, residence, employment and family are not four systems.\n\nTwo axes, deliberately not collapsed into one (Jesse, 2026-09-05, from two real examples). `valid_from`/`valid_to` answer whether the relationship holds AT ALL: a former job has valid_to set. `status` answers what KIND of true it is: an estranged daughter has valid_to null, because she is still his daughter, and status `estranged`. Fold those together and you get either an 'ex-daughter' or a former job that still reads as current.\n\nThe payoff is not the data, it is that a renderer can say 'Jesse's former job at Acme' rather than 'Jesse's job at Acme', and never says 'your boyfriend Alex' three weeks after a breakup. Free-text memory cannot reliably supply that tense today.\n\nThis is NOT an authorization edge. See grant.schema.json.",
  );
export type Relationship = z.infer<typeof Relationship>;
