// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/open-question.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**SPEC-01, folded in by the coherence review, 2026-09-14 (question 1, 'Four ask slots'): one of four ask mechanisms named across the design pass, the only one that needed its own record. `PendingAsk` (turnEngine.ts) is consumed by the very next utterance and stays a hub-internal field, not this. This is the OTHER kind: a question the hub wants to ask a specific person, not necessarily right now and not necessarily in the conversation that raised it - the judge's own open question about an unconfirmed inference (ASK-01 part 4), a `relay` queued for a household adult by AGE-01's `defer` move, a `clarify_fact` from a contradiction (CRED-01). Keyed by person, asked once at the end of that person's next reply on ANY conversation, then cleared - spec-shaped because the robot asks the same questions the hub queues. Replaces the earlier conversations.open_question column design (ASK-01's own draft), which this record supersedes before that column is ever built.*/
export const OpenQuestion = z
  .object({
    id: z.string().regex(new RegExp("^oq-[a-z0-9]{6,}$")),
    /**Who the question is asked OF, next time they speak - not necessarily who or what the question is about.*/
    person: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "Who the question is asked OF, next time they speak - not necessarily who or what the question is about.",
      ),
    /**The conversation this question arose from, when there is one to point back to. Asking happens on the person's NEXT reply on any conversation (the whole reason this is keyed by person, not by conversation), so this is provenance, not a constraint on where it gets asked.*/
    conversation_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^conv-[a-z0-9]{6,}$"))
          .describe(
            "The conversation this question arose from, when there is one to point back to. Asking happens on the person's NEXT reply on any conversation (the whole reason this is keyed by person, not by conversation), so this is provenance, not a constraint on where it gets asked.",
          ),
        z
          .null()
          .describe(
            "The conversation this question arose from, when there is one to point back to. Asking happens on the person's NEXT reply on any conversation (the whole reason this is keyed by person, not by conversation), so this is provenance, not a constraint on where it gets asked.",
          ),
      ])
      .describe(
        "The conversation this question arose from, when there is one to point back to. Asking happens on the person's NEXT reply on any conversation (the whole reason this is keyed by person, not by conversation), so this is provenance, not a constraint on where it gets asked.",
      )
      .default(null),
    /**who: an unconfirmed inference's own open question (ASK-01 part 4, 'is Alex your partner?'). clarify_fact: CRED-01's one clarification after a contradiction. relay: AGE-01's defer move, 'want me to tell them you asked?', queued for an adult on the child's behalf.*/
    kind: z
      .enum(["who", "clarify_fact", "relay"])
      .describe(
        "who: an unconfirmed inference's own open question (ASK-01 part 4, 'is Alex your partner?'). clarify_fact: CRED-01's one clarification after a contradiction. relay: AGE-01's defer move, 'want me to tell them you asked?', queued for an adult on the child's behalf.",
      ),
    /**The question, in the household's own words, asked verbatim - never re-generated at ask time.*/
    text: z
      .string()
      .min(1)
      .describe(
        "The question, in the household's own words, asked verbatim - never re-generated at ask time.",
      ),
    /**The entity or relationship this question is about, when there is one (an inferred relationship's own confirm, a contradicted memory record's subject entity). Null for a question with no single record behind it.*/
    subject_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^(ent|rel)-[a-z0-9]{6,}$"))
          .describe(
            "The entity or relationship this question is about, when there is one (an inferred relationship's own confirm, a contradicted memory record's subject entity). Null for a question with no single record behind it.",
          ),
        z
          .null()
          .describe(
            "The entity or relationship this question is about, when there is one (an inferred relationship's own confirm, a contradicted memory record's subject entity). Null for a question with no single record behind it.",
          ),
      ])
      .describe(
        "The entity or relationship this question is about, when there is one (an inferred relationship's own confirm, a contradicted memory record's subject entity). Null for a question with no single record behind it.",
      )
      .default(null),
    /**pending: queued, not yet asked. asked: appended to a reply, awaiting the person's next turn. answered/declined: the person responded either way. expired: never asked or answered within the household's own retention (a stale open question does not accumulate forever).*/
    status: z
      .enum(["pending", "asked", "answered", "declined", "expired"])
      .describe(
        "pending: queued, not yet asked. asked: appended to a reply, awaiting the person's next turn. answered/declined: the person responded either way. expired: never asked or answered within the household's own retention (a stale open question does not accumulate forever).",
      )
      .default("pending"),
    /**Free-text provenance (a turn id, a judge run id), matching memory-record.schema.json's own `source` field's convention.*/
    source: z
      .string()
      .min(1)
      .describe(
        "Free-text provenance (a turn id, a judge run id), matching memory-record.schema.json's own `source` field's convention.",
      ),
    created_at: z.string().datetime({ offset: true }),
    asked_at: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .default(null),
    resolved_at: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .default(null),
    /**Hybrid logical clock: wall_ms:counter:node (7.3), the same shape every other synced record type uses.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock: wall_ms:counter:node (7.3), the same shape every other synced record type uses.",
      ),
  })
  .strict()
  .describe(
    "SPEC-01, folded in by the coherence review, 2026-09-14 (question 1, 'Four ask slots'): one of four ask mechanisms named across the design pass, the only one that needed its own record. `PendingAsk` (turnEngine.ts) is consumed by the very next utterance and stays a hub-internal field, not this. This is the OTHER kind: a question the hub wants to ask a specific person, not necessarily right now and not necessarily in the conversation that raised it - the judge's own open question about an unconfirmed inference (ASK-01 part 4), a `relay` queued for a household adult by AGE-01's `defer` move, a `clarify_fact` from a contradiction (CRED-01). Keyed by person, asked once at the end of that person's next reply on ANY conversation, then cleared - spec-shaped because the robot asks the same questions the hub queues. Replaces the earlier conversations.open_question column design (ASK-01's own draft), which this record supersedes before that column is ever built.",
  );
export type OpenQuestion = z.infer<typeof OpenQuestion>;
