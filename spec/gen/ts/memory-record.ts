// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/memory-record.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**The shared shape for Memory, Entity, and Episode (platform plan 3.1 lists them as one row with one field set); record_kind is the discriminator. Embeddings themselves never sync (embedding_space only names the space). See 4.4 for the store's recall and maintenance rules this shape supports.*/
export const MemoryRecord = z
  .object({
    /**{prefix}{seq}-{device6}. Prefix follows record_kind: mem for memory, ent for entity, ep for episode.*/
    id: z
      .string()
      .regex(new RegExp("^(mem|ent|ep)[0-9]+-[a-z0-9]{6}$"))
      .describe(
        "{prefix}{seq}-{device6}. Prefix follows record_kind: mem for memory, ent for entity, ep for episode.",
      ),
    record_kind: z.enum(["memory", "entity", "episode"]),
    text: z.string().min(1),
    category: z.enum([
      "person",
      "place",
      "thing",
      "preference",
      "identity",
      "event",
      "project",
      "goal",
      "relationship",
      "fact",
      "state",
    ]),
    tier: z.enum(["durable", "episodic", "observation"]),
    status: z.enum(["active", "superseded", "archived"]),
    /**self: the companion's own memory of itself, not shared with anyone. companion (SPEC-01, dev.md 'Coherence review' question 1, 'one memory record, seven bumps'): the same idea keyed to one specific companion by companion_id, for a household running more than one companion package (COMP-03 onward) where 'itself' is no longer one thing.*/
    scope: z
      .enum(["household", "person", "self", "companion"])
      .describe(
        "self: the companion's own memory of itself, not shared with anyone. companion (SPEC-01, dev.md 'Coherence review' question 1, 'one memory record, seven bumps'): the same idea keyed to one specific companion by companion_id, for a household running more than one companion package (COMP-03 onward) where 'itself' is no longer one thing.",
      ),
    /**Required when scope is person; null for household, self or companion scope.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Required when scope is person; null for household, self or companion scope.",
          ),
        z
          .null()
          .describe(
            "Required when scope is person; null for household, self or companion scope.",
          ),
      ])
      .describe(
        "Required when scope is person; null for household, self or companion scope.",
      )
      .optional(),
    /**Required when scope is companion; null otherwise. Matches conversation.schema.json's own companion_id field's convention (a free string, package-declared - COMP-03 hasn't shipped an id format yet).*/
    companion_id: z
      .union([
        z
          .string()
          .describe(
            "Required when scope is companion; null otherwise. Matches conversation.schema.json's own companion_id field's convention (a free string, package-declared - COMP-03 hasn't shipped an id format yet).",
          ),
        z
          .null()
          .describe(
            "Required when scope is companion; null otherwise. Matches conversation.schema.json's own companion_id field's convention (a free string, package-declared - COMP-03 hasn't shipped an id format yet).",
          ),
      ])
      .describe(
        "Required when scope is companion; null otherwise. Matches conversation.schema.json's own companion_id field's convention (a free string, package-declared - COMP-03 hasn't shipped an id format yet).",
      )
      .default(null),
    /**The entity this record is about, when the judge or a person could name one (step 3a): a memory about a coworker names the coworker's entity, so recall and the guards find every record about them by id, not only by the name in the text. Null when the record is about nothing in the registry (a world fact, a preference of the speaker's own) or was written before this existed.*/
    subject_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
          .describe(
            "The entity this record is about, when the judge or a person could name one (step 3a): a memory about a coworker names the coworker's entity, so recall and the guards find every record about them by id, not only by the name in the text. Null when the record is about nothing in the registry (a world fact, a preference of the speaker's own) or was written before this existed.",
          ),
        z
          .null()
          .describe(
            "The entity this record is about, when the judge or a person could name one (step 3a): a memory about a coworker names the coworker's entity, so recall and the guards find every record about them by id, not only by the name in the text. Null when the record is about nothing in the registry (a world fact, a preference of the speaker's own) or was written before this existed.",
          ),
      ])
      .describe(
        "The entity this record is about, when the judge or a person could name one (step 3a): a memory about a coworker names the coworker's entity, so recall and the guards find every record about them by id, not only by the name in the text. Null when the record is about nothing in the registry (a world fact, a preference of the speaker's own) or was written before this existed.",
      )
      .default(null),
    /**Free-text provenance (e.g. a conversation turn id, a package id, an import job id).*/
    source: z
      .string()
      .min(1)
      .describe(
        "Free-text provenance (e.g. a conversation turn id, a package id, an import job id).",
      ),
    importance: z.number().gte(0).lte(1),
    pinned: z.boolean(),
    /**Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone (4.4).*/
    sensitive: z
      .boolean()
      .describe(
        "Withheld on shared surfaces and, on the robot, unless the person is confirmed present and alone (4.4).",
      ),
    /**AGE-01 (dev.md section 13 part 3 and part 9, the outside review reconciled; the coherence review, question 1: 'child_disclosure wins' over an earlier `audience` field name). Whether a CHILD may hear this record from the hub, separate from `sensitive` (which withholds from non-admins and shared surfaces regardless of age) and from `scope` (whose record it is). Null on person and self scope, where it is meaningless (the org's per-person identity rule already keeps a person-scoped record out of anyone else's context); meaningful on household and companion scope. A household-scope record's write-time default (AGE-01's own engine work, no writer yet) is deterministic, never the judge model's judgment: adult_only when the subject is a memorialized person or the text falls in one of vocab/life-events.json's own adult_to_tell classes, child_ok otherwise. An adult may flip it either way on the Memory page (a confirmed household-scope record's flip is an edit with provenance, like any other); the judge itself never sets or raises a record's disclosure - only the deterministic write-time default and an adult's own edit ever touch this field.*/
    child_disclosure: z
      .union([
        z.literal("child_ok"),
        z.literal("teen_ok"),
        z.literal("adult_only"),
        z.literal(null),
      ])
      .describe(
        "AGE-01 (dev.md section 13 part 3 and part 9, the outside review reconciled; the coherence review, question 1: 'child_disclosure wins' over an earlier `audience` field name). Whether a CHILD may hear this record from the hub, separate from `sensitive` (which withholds from non-admins and shared surfaces regardless of age) and from `scope` (whose record it is). Null on person and self scope, where it is meaningless (the org's per-person identity rule already keeps a person-scoped record out of anyone else's context); meaningful on household and companion scope. A household-scope record's write-time default (AGE-01's own engine work, no writer yet) is deterministic, never the judge model's judgment: adult_only when the subject is a memorialized person or the text falls in one of vocab/life-events.json's own adult_to_tell classes, child_ok otherwise. An adult may flip it either way on the Memory page (a confirmed household-scope record's flip is an edit with provenance, like any other); the judge itself never sets or raises a record's disclosure - only the deterministic write-time default and an adult's own edit ever touch this field.",
      )
      .default(null),
    /**Who last set child_disclosure, when it was an adult's explicit act rather than the write-time default. Null for a record still at its deterministic default.*/
    child_disclosure_set_by: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Who last set child_disclosure, when it was an adult's explicit act rather than the write-time default. Null for a record still at its deterministic default.",
          ),
        z
          .null()
          .describe(
            "Who last set child_disclosure, when it was an adult's explicit act rather than the write-time default. Null for a record still at its deterministic default.",
          ),
      ])
      .describe(
        "Who last set child_disclosure, when it was an adult's explicit act rather than the write-time default. Null for a record still at its deterministic default.",
      )
      .default(null),
    /**When child_disclosure_set_by acted. Null alongside it.*/
    child_disclosure_set_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe("When child_disclosure_set_by acted. Null alongside it."),
        z
          .null()
          .describe("When child_disclosure_set_by acted. Null alongside it."),
      ])
      .describe("When child_disclosure_set_by acted. Null alongside it.")
      .default(null),
    /**CRED-01 (dev.md section 14 part 1, named against the signal's act_confidence per the outside review - never a bare `confidence` beside it). Required (non-null) on record_kind: memory only; always null on entity and episode (an entity or an episode never acquires fact credence by accident), enforced in validate.ts, the same place/person cross-field convention as elsewhere in this schema. How much support a stored proposition has, never how believable the person is: there is no person-level reliability score anywhere in this shape. Computed, never incremented, by CRED-01's own computeFactConfidence() from confidence_evidence below; records written before this field existed migrate to 1.0 with one synthetic legacy_assertion evidence entry, because the product already said them plainly and a migration that invents doubt about every old memory would be wrong. No writer until CRED-01.*/
    fact_confidence: z
      .union([
        z
          .number()
          .gte(0)
          .lte(1)
          .describe(
            "CRED-01 (dev.md section 14 part 1, named against the signal's act_confidence per the outside review - never a bare `confidence` beside it). Required (non-null) on record_kind: memory only; always null on entity and episode (an entity or an episode never acquires fact credence by accident), enforced in validate.ts, the same place/person cross-field convention as elsewhere in this schema. How much support a stored proposition has, never how believable the person is: there is no person-level reliability score anywhere in this shape. Computed, never incremented, by CRED-01's own computeFactConfidence() from confidence_evidence below; records written before this field existed migrate to 1.0 with one synthetic legacy_assertion evidence entry, because the product already said them plainly and a migration that invents doubt about every old memory would be wrong. No writer until CRED-01.",
          ),
        z
          .null()
          .describe(
            "CRED-01 (dev.md section 14 part 1, named against the signal's act_confidence per the outside review - never a bare `confidence` beside it). Required (non-null) on record_kind: memory only; always null on entity and episode (an entity or an episode never acquires fact credence by accident), enforced in validate.ts, the same place/person cross-field convention as elsewhere in this schema. How much support a stored proposition has, never how believable the person is: there is no person-level reliability score anywhere in this shape. Computed, never incremented, by CRED-01's own computeFactConfidence() from confidence_evidence below; records written before this field existed migrate to 1.0 with one synthetic legacy_assertion evidence entry, because the product already said them plainly and a migration that invents doubt about every old memory would be wrong. No writer until CRED-01.",
          ),
      ])
      .describe(
        "CRED-01 (dev.md section 14 part 1, named against the signal's act_confidence per the outside review - never a bare `confidence` beside it). Required (non-null) on record_kind: memory only; always null on entity and episode (an entity or an episode never acquires fact credence by accident), enforced in validate.ts, the same place/person cross-field convention as elsewhere in this schema. How much support a stored proposition has, never how believable the person is: there is no person-level reliability score anywhere in this shape. Computed, never incremented, by CRED-01's own computeFactConfidence() from confidence_evidence below; records written before this field existed migrate to 1.0 with one synthetic legacy_assertion evidence entry, because the product already said them plainly and a migration that invents doubt about every old memory would be wrong. No writer until CRED-01.",
      )
      .default(null),
    /**CRED-01: the reason fact_confidence is what it is. Merged on sync as a set union by (source_id, kind) followed by recomputation, so a corroboration seen on the robot is never lost when the hub and the robot reconcile. Empty (not null) on record_kind: entity or episode, matching fact_confidence's own null there. No writer until CRED-01.*/
    confidence_evidence: z
      .array(
        z
          .object({
            /**A turn, an integration result, or an explicit confirmation - whatever grounds this entry.*/
            source_id: z
              .string()
              .min(1)
              .describe(
                "A turn, an integration result, or an explicit confirmation - whatever grounds this entry.",
              ),
            source_person_id: z
              .union([
                z.string().regex(new RegExp("^person-[a-z0-9]{6,}$")),
                z.null(),
              ])
              .default(null),
            kind: z.enum([
              "initial_assertion",
              "detail",
              "reassertion",
              "corroboration",
              "contradiction",
              "clarification",
              "legacy_assertion",
            ]),
            observed_at: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .describe(
        "CRED-01: the reason fact_confidence is what it is. Merged on sync as a set union by (source_id, kind) followed by recomputation, so a corroboration seen on the robot is never lost when the hub and the robot reconcile. Empty (not null) on record_kind: entity or episode, matching fact_confidence's own null there. No writer until CRED-01.",
      )
      .default([]),
    /**CRED-01: the ids of unresolved contradicting records. Distinct from superseded_by below: a conflict is unresolved (both records stay provisional and conflicted until a clarification lands), a supersession is settled. No writer until CRED-01.*/
    conflicts_with: z
      .array(z.string().regex(new RegExp("^(mem|ent|ep)[0-9]+-[a-z0-9]{6}$")))
      .describe(
        "CRED-01: the ids of unresolved contradicting records. Distinct from superseded_by below: a conflict is unresolved (both records stay provisional and conflicted until a clarification lands), a supersession is settled. No writer until CRED-01.",
      )
      .default([]),
    uses: z.number().int().gte(0),
    /**REVIEW-01 (dev.md 'Coherence review' question 1, 'one memory record, seven bumps'; coordinator ruling, 2026-09-14): how many times this record, once recalled, led to a correction by the person - written only by REVIEW-01, no writer until it lands. Ranking derives any penalty from this deterministically in one engine function; the number itself is never a rank or a score, so it stays auditable rather than an opaque incrementing weight.*/
    retrieval_feedback: z
      .object({
        corrections: z.number().int().gte(0).default(0),
        last_corrected_at: z
          .union([z.string().datetime({ offset: true }), z.null()])
          .default(null),
      })
      .strict()
      .describe(
        "REVIEW-01 (dev.md 'Coherence review' question 1, 'one memory record, seven bumps'; coordinator ruling, 2026-09-14): how many times this record, once recalled, led to a correction by the person - written only by REVIEW-01, no writer until it lands. Ranking derives any penalty from this deterministically in one engine function; the number itself is never a rank or a score, so it stays auditable rather than an opaque incrementing weight.",
      )
      .default({ corrections: 0, last_corrected_at: null }),
    created_at: z.string().datetime({ offset: true }),
    last_used_at: z.string().datetime({ offset: true }),
    valid_from: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .default(null),
    /**When the fact stopped being true, distinct from expired_at (when we retired it).*/
    valid_to: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When the fact stopped being true, distinct from expired_at (when we retired it).",
          ),
        z
          .null()
          .describe(
            "When the fact stopped being true, distinct from expired_at (when we retired it).",
          ),
      ])
      .describe(
        "When the fact stopped being true, distinct from expired_at (when we retired it).",
      )
      .default(null),
    expired_at: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .default(null),
    superseded_by: z
      .union([
        z.string().regex(new RegExp("^(mem|ent|ep)[0-9]+-[a-z0-9]{6}$")),
        z.null(),
      ])
      .default(null),
    /**Names the embedding space this record was indexed under, e.g. hub-bge-m3 or bot-minilm. The embedding vector itself is never part of this record and never syncs (4.11).*/
    embedding_space: z
      .union([
        z
          .string()
          .describe(
            "Names the embedding space this record was indexed under, e.g. hub-bge-m3 or bot-minilm. The embedding vector itself is never part of this record and never syncs (4.11).",
          ),
        z
          .null()
          .describe(
            "Names the embedding space this record was indexed under, e.g. hub-bge-m3 or bot-minilm. The embedding vector itself is never part of this record and never syncs (4.11).",
          ),
      ])
      .describe(
        "Names the embedding space this record was indexed under, e.g. hub-bge-m3 or bot-minilm. The embedding vector itself is never part of this record and never syncs (4.11).",
      )
      .default(null),
    /**Hybrid logical clock: wall_ms:counter:node (7.3).*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe("Hybrid logical clock: wall_ms:counter:node (7.3)."),
    /**Set when a person asks to forget this record (session-a-intelligence.md step 10): the row is kept as a tombstone, not hard-deleted, so a later sync cannot resurrect it. text is wiped and embedding_space cleared when this is set; status becomes archived. Distinct from a person's own deleted_at (person.schema.json): this is about ONE memory, not the whole person.*/
    deleted_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "Set when a person asks to forget this record (session-a-intelligence.md step 10): the row is kept as a tombstone, not hard-deleted, so a later sync cannot resurrect it. text is wiped and embedding_space cleared when this is set; status becomes archived. Distinct from a person's own deleted_at (person.schema.json): this is about ONE memory, not the whole person.",
          ),
        z
          .null()
          .describe(
            "Set when a person asks to forget this record (session-a-intelligence.md step 10): the row is kept as a tombstone, not hard-deleted, so a later sync cannot resurrect it. text is wiped and embedding_space cleared when this is set; status becomes archived. Distinct from a person's own deleted_at (person.schema.json): this is about ONE memory, not the whole person.",
          ),
      ])
      .describe(
        "Set when a person asks to forget this record (session-a-intelligence.md step 10): the row is kept as a tombstone, not hard-deleted, so a later sync cannot resurrect it. text is wiped and embedding_space cleared when this is set; status becomes archived. Distinct from a person's own deleted_at (person.schema.json): this is about ONE memory, not the whole person.",
      )
      .default(null),
  })
  .strict()
  .describe(
    "The shared shape for Memory, Entity, and Episode (platform plan 3.1 lists them as one row with one field set); record_kind is the discriminator. Embeddings themselves never sync (embedding_space only names the space). See 4.4 for the store's recall and maintenance rules this shape supports.",
  );
export type MemoryRecord = z.infer<typeof MemoryRecord>;
