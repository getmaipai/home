// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/conversation-turn.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**SPEC-01 (dev.md section 12, 'What exists today': 'conversation_turns is hub-internal while the conversation spec says robot turns sync through the hub: a shared turn record is a debt this item pays, because the signal has to live on it'). One completed turn, spec-shaped so the hub and the robot agree on its fields (backend/src/db/schema.ts's own conversationTurns table stays the hub's storage; this is the shape a sync payload and a fixture agree on, additive to what that table already carries - the fields this migration adds are signal, plan, subjects, outcomes typed, document, review_id and notice_ids; ACT-01 onward writes them, no writer yet). `signal` is required (ACT-01 computes it for every turn, package and command turns included, before routing); `plan`, `subjects`, `outcomes`, `document`, `review_id` and `notice_ids` stay null until the items that write them (ACT-03, CHAT-13, existing package handling, COMP-01, REVIEW-01, AGE-02) land.*/
export const ConversationTurn = z
  .object({
    id: z.string().regex(new RegExp("^turn-[a-z0-9]{6,}$")),
    conversation_id: z.string().regex(new RegExp("^conv-[a-z0-9]{6,}$")),
    /**The chosen turn this record branches from, or null for the conversation's first turn. Sibling alternatives share the same parent; a linear follow-up points at the latest chosen turn.*/
    parent_turn_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^turn-[a-z0-9]{6,}$"))
          .describe(
            "The chosen turn this record branches from, or null for the conversation's first turn. Sibling alternatives share the same parent; a linear follow-up points at the latest chosen turn.",
          ),
        z
          .null()
          .describe(
            "The chosen turn this record branches from, or null for the conversation's first turn. Sibling alternatives share the same parent; a linear follow-up points at the latest chosen turn.",
          ),
      ])
      .describe(
        "The chosen turn this record branches from, or null for the conversation's first turn. Sibling alternatives share the same parent; a linear follow-up points at the latest chosen turn.",
      )
      .default(null),
    /**Whether this turn is the selected sibling in its branch slot. Exactly one sibling is chosen locally; a merge resolves concurrent choices by the latest HLC.*/
    branch_chosen: z
      .boolean()
      .describe(
        "Whether this turn is the selected sibling in its branch slot. Exactly one sibling is chosen locally; a merge resolves concurrent choices by the latest HLC.",
      )
      .default(true),
    /**Who spoke, captured at write time (a role can change later).*/
    person: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe("Who spoke, captured at write time (a role can change later)."),
    surface: z.enum(["chat", "overlay", "pod", "robot", "tv", "phone"]),
    user_text: z.string(),
    reply_text: z.string(),
    /**Matches backend/src/wire.ts's TurnValue.source.*/
    source: z
      .enum([
        "safety_refuse",
        "plugin",
        "plugin_error",
        "command",
        "command_error",
        "model",
        "confirm",
        "policy",
      ])
      .describe("Matches backend/src/wire.ts's TurnValue.source."),
    /**SPEC-01 (dev.md section 12, 'The act and the emotion of a turn, and the register they drive'). What kind of turn a person just made and how it felt, computed once by classifyTurnSignal() before the model runs and frozen on the turn (never recomputed later, so the judge and REVIEW-01 read what the engine believed at the time). A value shape, not its own synced row: it is carried on conversation-turn.schema.json's own `signal` field, the one record the hub and the robot both sync. `expressed_emotion` is named for exactly what it is - what the words express - because the engine never states an inferred feeling back to the person as if it knew their inner state.*/
    signal: z
      .object({
        /**The clause that determines the immediate response, by a fixed precedence: directive, question, commissive, inform, then the management acts.*/
        primary_act: z
          .enum([
            "inform",
            "question",
            "directive",
            "commissive",
            "greeting",
            "closing",
            "backchannel",
          ])
          .describe(
            "The clause that determines the immediate response, by a fixed precedence: directive, question, commissive, inform, then the management acts.",
          ),
        /**The other clauses' acts, ordered, so a turn with more than one request keeps every one of them ('add milk, and when is Pippa's appointment').*/
        secondary_acts: z
          .array(
            z
              .enum([
                "inform",
                "question",
                "directive",
                "commissive",
                "greeting",
                "closing",
                "backchannel",
              ])
              .describe(
                "DailyDialog's four (inform, question, directive, commissive) plus the three management acts the findings need (greeting, closing, backchannel), which DailyDialog folds into inform.",
              ),
          )
          .describe(
            "The other clauses' acts, ordered, so a turn with more than one request keeps every one of them ('add milk, and when is Pippa's appointment').",
          )
          .default([]),
        /**DailyDialog's Ekman-six-plus-neutral set. What the words express, never a claim about the person's inner state.*/
        expressed_emotion: z
          .enum([
            "neutral",
            "happiness",
            "surprise",
            "sadness",
            "anger",
            "disgust",
            "fear",
          ])
          .describe(
            "DailyDialog's Ekman-six-plus-neutral set. What the words express, never a claim about the person's inner state.",
          ),
        /**Deterministic from surface cues (capitals, repeated punctuation, an expletive, a repeated word, a strong intensifier), never a classifier's own confidence read as intensity.*/
        emotion_intensity: z
          .enum(["none", "low", "moderate", "high"])
          .describe(
            "Deterministic from surface cues (capitals, repeated punctuation, an expletive, a repeated word, a strong intensifier), never a classifier's own confidence read as intensity.",
          ),
        /**Whom the emotion is about. Anger at the hub and sadness about oneself drive different moves and different memory.*/
        target: z
          .enum(["self", "other", "hub", "world"])
          .describe(
            "Whom the emotion is about. Anger at the hub and sadness about oneself drive different moves and different memory.",
          ),
        /**Orthogonal to the act: 'no, Friday, not Thursday' is still an inform. CHAT-13's rejected-subject rule and the memory supersede path read this.*/
        repair: z
          .enum(["none", "correction", "retraction"])
          .describe(
            "Orthogonal to the act: 'no, Friday, not Thursday' is still an inform. CHAT-13's rejected-subject rule and the memory supersede path read this.",
          ),
        /**Whether the turn leans on a previous turn (a bare pronoun, ellipsis, a reflected question), read from CHAT-13's resolver, never recomputed here. Absent (null) until CHAT-13 lands; the coherence review states this explicitly on the schema rather than leaving it implied.*/
        refers_to_prior: z
          .union([
            z
              .boolean()
              .describe(
                "Whether the turn leans on a previous turn (a bare pronoun, ellipsis, a reflected question), read from CHAT-13's resolver, never recomputed here. Absent (null) until CHAT-13 lands; the coherence review states this explicitly on the schema rather than leaving it implied.",
              ),
            z
              .null()
              .describe(
                "Whether the turn leans on a previous turn (a bare pronoun, ellipsis, a reflected question), read from CHAT-13's resolver, never recomputed here. Absent (null) until CHAT-13 lands; the coherence review states this explicitly on the schema rather than leaving it implied.",
              ),
          ])
          .describe(
            "Whether the turn leans on a previous turn (a bare pronoun, ellipsis, a reflected question), read from CHAT-13's resolver, never recomputed here. Absent (null) until CHAT-13 lands; the coherence review states this explicitly on the schema rather than leaving it implied.",
          )
          .default(null),
        clauses: z
          .array(
            z
              .object({
                /**The character range of this clause within the turn's utterance text, from the same split utteranceShape() already makes.*/
                range: z
                  .object({
                    start: z.number().int().gte(0),
                    end: z.number().int().gte(0),
                  })
                  .strict()
                  .describe(
                    "The character range of this clause within the turn's utterance text, from the same split utteranceShape() already makes.",
                  ),
                /**DailyDialog's four (inform, question, directive, commissive) plus the three management acts the findings need (greeting, closing, backchannel), which DailyDialog folds into inform.*/
                act: z
                  .enum([
                    "inform",
                    "question",
                    "directive",
                    "commissive",
                    "greeting",
                    "closing",
                    "backchannel",
                  ])
                  .describe(
                    "DailyDialog's four (inform, question, directive, commissive) plus the three management acts the findings need (greeting, closing, backchannel), which DailyDialog folds into inform.",
                  ),
                /**Whose claim a clause is, and how literally to take it. `unknown` writes nothing about anyone (MEM-06): precision wins on an uncertain label.*/
                stance: z
                  .enum([
                    "asserted",
                    "reported",
                    "quoted",
                    "hypothetical",
                    "joke",
                    "unknown",
                  ])
                  .describe(
                    "Whose claim a clause is, and how literally to take it. `unknown` writes nothing about anyone (MEM-06): precision wins on an uncertain label.",
                  ),
                /**Who or what a clause is about. A reference into the turn's own SubjectRef list (subject-ref.schema.json), never a third name-carrying shape: `named` repeats the entity id a SubjectRef on the same turn already resolved.*/
                subject: z
                  .any()
                  .superRefine((x, ctx) => {
                    const schemas = [
                      z.object({ kind: z.literal("speaker") }).strict(),
                      z.object({ kind: z.literal("household") }).strict(),
                      z.object({ kind: z.literal("world") }).strict(),
                      z.object({ kind: z.literal("unknown") }).strict(),
                      z
                        .object({
                          kind: z.literal("named"),
                          name: z.string().min(1),
                          /**Null when the name resolved to an unresolved SubjectRef rather than a household entity yet.*/
                          entity_id: z
                            .union([
                              z
                                .string()
                                .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
                                .describe(
                                  "Null when the name resolved to an unresolved SubjectRef rather than a household entity yet.",
                                ),
                              z
                                .null()
                                .describe(
                                  "Null when the name resolved to an unresolved SubjectRef rather than a household entity yet.",
                                ),
                            ])
                            .describe(
                              "Null when the name resolved to an unresolved SubjectRef rather than a household entity yet.",
                            ),
                        })
                        .strict(),
                    ];
                    const { errors, failed } = schemas.reduce<{
                      errors: z.core.$ZodIssue[];
                      failed: number;
                    }>(
                      ({ errors, failed }, schema) =>
                        ((result) =>
                          result.error
                            ? {
                                errors: [...errors, ...result.error.issues],
                                failed: failed + 1,
                              }
                            : { errors, failed })(schema.safeParse(x)),
                      { errors: [], failed: 0 },
                    );
                    const passed = schemas.length - failed;
                    if (passed !== 1) {
                      ctx.addIssue(
                        errors.length
                          ? {
                              path: [],
                              code: "invalid_union",
                              errors: [errors],
                              message:
                                "Invalid input: Should pass single schema. Passed " +
                                passed,
                            }
                          : {
                              path: [],
                              code: "custom",
                              errors: [errors],
                              message:
                                "Invalid input: Should pass single schema. Passed " +
                                passed,
                            },
                      );
                    }
                  })
                  .describe(
                    "Who or what a clause is about. A reference into the turn's own SubjectRef list (subject-ref.schema.json), never a third name-carrying shape: `named` repeats the entity id a SubjectRef on the same turn already resolved.",
                  ),
                emotion: z.enum([
                  "neutral",
                  "happiness",
                  "surprise",
                  "sadness",
                  "anger",
                  "disgust",
                  "fear",
                ]),
                emotion_intensity: z.enum(["none", "low", "moderate", "high"]),
                confidence: z.number().gte(0).lte(1),
              })
              .strict()
              .describe(
                "One entry per clause (a turn may carry several: 'Pippa said she hates cilantro, but I'd eat it if it were milder' is one turn with a reported clause about Pippa and a hypothetical clause about the speaker). The turn-level fields below are derived from these, never classified separately.",
              ),
          )
          .min(1),
        act_confidence: z.number().gte(0).lte(1),
        emotion_confidence: z.number().gte(0).lte(1),
        /**Which layer of classifyTurnSignal() produced this: protocol state, a high-precision rule, a trained head over the turn's own embedding, or the conservative fallback.*/
        source: z
          .enum(["protocol", "rule", "head", "fallback"])
          .describe(
            "Which layer of classifyTurnSignal() produced this: protocol state, a high-precision rule, a trained head over the turn's own embedding, or the conservative fallback.",
          ),
        /**The artifact's identity (model-capabilities.schema.json's turn-signal role) when source is head, so a persisted signal says what produced it. Null for every other source.*/
        classifier_id: z
          .union([
            z
              .string()
              .describe(
                "The artifact's identity (model-capabilities.schema.json's turn-signal role) when source is head, so a persisted signal says what produced it. Null for every other source.",
              ),
            z
              .null()
              .describe(
                "The artifact's identity (model-capabilities.schema.json's turn-signal role) when source is head, so a persisted signal says what produced it. Null for every other source.",
              ),
          ])
          .describe(
            "The artifact's identity (model-capabilities.schema.json's turn-signal role) when source is head, so a persisted signal says what produced it. Null for every other source.",
          )
          .default(null),
        /**Section 13, the outside review reconciled: the band on the frozen signal, one spec enum every reader (speakerAgeBand(), the ceiling, the plan, the judge, the robot) uses, never the birthday or a numeric age on a turn.*/
        age_band: z
          .enum(["child", "teen", "adult"])
          .describe(
            "Section 13, the outside review reconciled: the band on the frozen signal, one spec enum every reader (speakerAgeBand(), the ceiling, the plan, the judge, the robot) uses, never the birthday or a numeric age on a turn.",
          ),
        /**identified_profile: the band came from a signed-in or identified person's role and birthday. unknown_speaker_default: an unidentified or low-confidence speaker on a shared surface, given the strictest applicable policy (COMP-06, section 13 part 6) - the child band, until the person is identified.*/
        age_band_basis: z
          .enum(["identified_profile", "unknown_speaker_default"])
          .describe(
            "identified_profile: the band came from a signed-in or identified person's role and birthday. unknown_speaker_default: an unidentified or low-confidence speaker on a shared surface, given the strictest applicable policy (COMP-06, section 13 part 6) - the child band, until the person is identified.",
          ),
      })
      .strict()
      .describe(
        "SPEC-01 (dev.md section 12, 'The act and the emotion of a turn, and the register they drive'). What kind of turn a person just made and how it felt, computed once by classifyTurnSignal() before the model runs and frozen on the turn (never recomputed later, so the judge and REVIEW-01 read what the engine believed at the time). A value shape, not its own synced row: it is carried on conversation-turn.schema.json's own `signal` field, the one record the hub and the robot both sync. `expressed_emotion` is named for exactly what it is - what the words express - because the engine never states an inferred feeling back to the person as if it knew their inner state.",
      ),
    plan: z
      .union([
        z
          .object({
            moves: z
              .object({
                /**A short reaction to the emotion or the news.*/
                react: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe("A short reaction to the emotion or the news."),
                /**An acknowledgment of a marked emotion, ahead of any other content.*/
                care: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe(
                    "An acknowledgment of a marked emotion, ahead of any other content.",
                  ),
                /**The substantive answer or acknowledgment.*/
                say: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe("The substantive answer or acknowledgment."),
                /**Choosing one of several candidates the evidence offers.*/
                pick: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe(
                    "Choosing one of several candidates the evidence offers.",
                  ),
                /**Citing a source, a link, or a document - forbidden on the child band (section 13 part 1).*/
                point: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe(
                    "Citing a source, a link, or a document - forbidden on the child band (section 13 part 1).",
                  ),
                /**A follow-up question.*/
                ask_back: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe("A follow-up question."),
                /**A reciprocal closing.*/
                close: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe("A reciprocal closing."),
                /**AGE-01 (section 13 part 3): naming a trusted adult as the place for what the hub will not decide or recite, rather than pointing to a source. The trusted-adult move, distinct from `point`.*/
                defer: z
                  .enum(["required", "allowed", "forbidden"])
                  .describe(
                    "AGE-01 (section 13 part 3): naming a trusted adult as the place for what the hub will not decide or recite, rather than pointing to a source. The trusted-adult move, distinct from `point`.",
                  ),
              })
              .strict(),
            /**Forbidden under every negative-emotion override and on the child band whenever a negative emotion or a harm/illness/death/living-thing question is in play (section 13 part 1).*/
            playfulness: z
              .enum(["allowed", "forbidden"])
              .describe(
                "Forbidden under every negative-emotion override and on the child band whenever a negative emotion or a harm/illness/death/living-thing question is in play (section 13 part 1).",
              ),
            max_sentences: z.number().int().gte(1),
            max_words: z.number().int().gte(1),
            /**Copied from the frozen TurnSignal.age_band, so the plan is self-contained for the composer and the guards without a second read of the signal.*/
            age_band: z
              .enum(["child", "teen", "adult"])
              .describe(
                "Copied from the frozen TurnSignal.age_band, so the plan is self-contained for the composer and the guards without a second read of the signal.",
              ),
            /**Section 13 part 1's own `complexity` dial, renamed and moved here (the coherence review, question 1: 'vocabulary_level replaces a forced complexity dial, one field'). `simple` forced on the child band; capped at `standard` on the teen band; the companion's own dial on adult, never above what the band allows.*/
            vocabulary_level: z
              .enum(["simple", "standard", "advanced"])
              .describe(
                "Section 13 part 1's own `complexity` dial, renamed and moved here (the coherence review, question 1: 'vocabulary_level replaces a forced complexity dial, one field'). `simple` forced on the child band; capped at `standard` on the teen band; the companion's own dial on adult, never above what the band allows.",
              ),
            /**Section 13 part 1: `concrete` on the child band (concrete words, no abstractions, no idioms a child cannot parse); `plain` on the teen band (no talking down); `full` on the adult band (the companion's own register). AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
            explanation_style: z
              .enum(["concrete", "plain", "full"])
              .describe(
                "Section 13 part 1: `concrete` on the child band (concrete words, no abstractions, no idioms a child cannot parse); `plain` on the teen band (no talking down); `full` on the adult band (the companion's own register). AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
              ),
            /**Section 13 part 3: how the `defer` move, when present, should read. `name_adult`: name a trusted adult as the place for the answer. `offer_to_ask`: also offer to relay the child's question to them (queues an OpenQuestion of kind `relay`). `none` when `defer` is not `required` or `allowed` this turn. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
            trusted_adult_move: z
              .enum(["none", "name_adult", "offer_to_ask"])
              .describe(
                "Section 13 part 3: how the `defer` move, when present, should read. `name_adult`: name a trusted adult as the place for the answer. `offer_to_ask`: also offer to relay the child's question to them (queues an OpenQuestion of kind `relay`). `none` when `defer` is not `required` or `allowed` this turn. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
              ),
            /**Section 13 part 2: whether every piece of evidence handed to the composer this turn was shown in full, or at least one item was summarized or withheld by the content ceiling or a household record's child_disclosure - so the reply can say so honestly ('some of what came back is for grown-ups') rather than pretending nothing was found. The per-item detail lives on the bench's own evidenceDisposition expectation, not here; this is the one summary bit the plan carries. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
            content_disclosure: z
              .enum(["full", "some_withheld"])
              .describe(
                "Section 13 part 2: whether every piece of evidence handed to the composer this turn was shown in full, or at least one item was summarized or withheld by the content ceiling or a household record's child_disclosure - so the reply can say so honestly ('some of what came back is for grown-ups') rather than pretending nothing was found. The per-item detail lives on the bench's own evidenceDisposition expectation, not here; this is the one summary bit the plan carries. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
              ),
          })
          .strict()
          .describe(
            "SPEC-01 (dev.md section 12 part 3, amended by section 13 part 9 and the coherence review, question 1). A plan of permitted moves, not an order: the engine turns the signal, the protocol state, the surface, an explicit brevity request, the age band and the available evidence into this, and the composer realizes it in the companion's voice. Replaces the composer's earlier fixed 'react, pick, say, point' order (dev.md section 6 part 1, amended). A value shape, carried on conversation-turn.schema.json's own `plan` field, never synced independently. The move vocabulary is declared once, exactly here: react, care, say, pick, point, ask_back, close, defer - no item may add a ninth.\n\nWhat this deliberately does not carry (ACT-03 narrowed, the coherence review's over-design finding): no `claim_state` (section 14, deferred to CRED-01), no `credulity` block (section 15, deferred), no typed move fields on a streamed chat turn (those exist only on a composed/lookup turn's ComposedTurn, off the interactive path per the review's cost analysis - a streamed reply is checked against this plan at the guard boundary instead, by deterministic signs in the sentences).",
          ),
        z.null(),
      ])
      .default(null),
    /**CHAT-13's stack of what the conversation is about, as it stood after this turn.*/
    subjects: z
      .union([
        z
          .array(
            z
              .any()
              .superRefine((x, ctx) => {
                const schemas = [
                  z
                    .object({
                      type: z.literal("household"),
                      /**Authoritative: the turn resolved this to a real entity in the household's graph.*/
                      entity_id: z
                        .string()
                        .regex(new RegExp("^ent-[a-z0-9]{6,}$"))
                        .describe(
                          "Authoritative: the turn resolved this to a real entity in the household's graph.",
                        ),
                      /**CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.*/
                      carried_question: z
                        .union([
                          z
                            .string()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                          z
                            .null()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                        ])
                        .describe(
                          "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                        ),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal("world"),
                      /**What sort of world thing this is (film, album, book, show, game, band, product, place, event, ...). Free text, not a closed enum: the space of things a household might ask about is far larger than entity.schema.json's own household kinds, and nothing downstream branches on it beyond display.*/
                      kind: z
                        .string()
                        .min(1)
                        .describe(
                          "What sort of world thing this is (film, album, book, show, game, band, product, place, event, ...). Free text, not a closed enum: the space of things a household might ask about is far larger than entity.schema.json's own household kinds, and nothing downstream branches on it beyond display.",
                        ),
                      display_name: z.string().min(1),
                      year: z.union([z.number().int(), z.null()]),
                      /**source.schema.json's own `kind` enum: which typed lookup answered, when one did. Null when nothing has answered yet (a subject named in the utterance before any lookup ran).*/
                      source_kind: z
                        .union([
                          z.literal("web"),
                          z.literal("wikidata"),
                          z.literal("wikipedia"),
                          z.literal("weather"),
                          z.literal("package"),
                          z.literal(null),
                        ])
                        .describe(
                          "source.schema.json's own `kind` enum: which typed lookup answered, when one did. Null when nothing has answered yet (a subject named in the utterance before any lookup ran).",
                        ),
                      /**The typed source's own stable identifier for this subject (a Wikidata QID, a Wikipedia page title), when source_kind is set. Null otherwise.*/
                      stable_key: z
                        .union([
                          z
                            .string()
                            .describe(
                              "The typed source's own stable identifier for this subject (a Wikidata QID, a Wikipedia page title), when source_kind is set. Null otherwise.",
                            ),
                          z
                            .null()
                            .describe(
                              "The typed source's own stable identifier for this subject (a Wikidata QID, a Wikipedia page title), when source_kind is set. Null otherwise.",
                            ),
                        ])
                        .describe(
                          "The typed source's own stable identifier for this subject (a Wikidata QID, a Wikipedia page title), when source_kind is set. Null otherwise.",
                        ),
                      /**`current` when the utterance's own words (new, upcoming, latest, this season, coming out, just dropped, the remake, the sequel) or a typed source date this within the last year; `dated` when a typed source dates it earlier; `unknown` otherwise. CHAT-13's rule: only a `dated` subject may take an exact field from the model's own knowledge.*/
                      recency: z
                        .enum(["current", "dated", "unknown"])
                        .describe(
                          "`current` when the utterance's own words (new, upcoming, latest, this season, coming out, just dropped, the remake, the sequel) or a typed source date this within the last year; `dated` when a typed source dates it earlier; `unknown` otherwise. CHAT-13's rule: only a `dated` subject may take an exact field from the model's own knowledge.",
                        ),
                      /**CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.*/
                      carried_question: z
                        .union([
                          z
                            .string()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                          z
                            .null()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                        ])
                        .describe(
                          "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                        ),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal("unresolved"),
                      /**The name exactly as the person said it.*/
                      surface_form: z
                        .string()
                        .min(1)
                        .describe("The name exactly as the person said it."),
                      /**ASK-01's own hint: entity.schema.json kinds this name plausibly refers to, read from a relation phrase's noun via vocab/entity-kind-nouns.json. Empty when nothing hinted a kind.*/
                      candidate_kinds: z
                        .array(
                          z.enum([
                            "person",
                            "pet",
                            "place",
                            "organization",
                            "thing",
                          ]),
                        )
                        .min(0)
                        .describe(
                          "ASK-01's own hint: entity.schema.json kinds this name plausibly refers to, read from a relation phrase's noun via vocab/entity-kind-nouns.json. Empty when nothing hinted a kind.",
                        ),
                      /**Where this reference came from (a turn id, a conversation id): free-text, matching memory-record.schema.json's own `source` field's convention.*/
                      provenance: z
                        .string()
                        .min(1)
                        .describe(
                          "Where this reference came from (a turn id, a conversation id): free-text, matching memory-record.schema.json's own `source` field's convention.",
                        ),
                      confidence: z.number().gte(0).lte(1),
                      /**CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.*/
                      carried_question: z
                        .union([
                          z
                            .string()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                          z
                            .null()
                            .describe(
                              "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                            ),
                        ])
                        .describe(
                          "CHAT-13's rejected-subject rule (dev.md section 4): after a correction replaces the active subject, the unresolved question from before the correction is carried here (its text) so the engine re-asks it against the corrected subject on the next turn, or on a bare 'do it'/'go on', without the person repeating it. Null once answered, and always null outside a stack entry.",
                        ),
                    })
                    .strict(),
                ];
                const { errors, failed } = schemas.reduce<{
                  errors: z.core.$ZodIssue[];
                  failed: number;
                }>(
                  ({ errors, failed }, schema) =>
                    ((result) =>
                      result.error
                        ? {
                            errors: [...errors, ...result.error.issues],
                            failed: failed + 1,
                          }
                        : { errors, failed })(schema.safeParse(x)),
                  { errors: [], failed: 0 },
                );
                const passed = schemas.length - failed;
                if (passed !== 1) {
                  ctx.addIssue(
                    errors.length
                      ? {
                          path: [],
                          code: "invalid_union",
                          errors: [errors],
                          message:
                            "Invalid input: Should pass single schema. Passed " +
                            passed,
                        }
                      : {
                          path: [],
                          code: "custom",
                          errors: [errors],
                          message:
                            "Invalid input: Should pass single schema. Passed " +
                            passed,
                        },
                  );
                }
              })
              .describe(
                "SPEC-01, folded in from ASK-01 and CHAT-13's own design by the coherence review, 2026-09-14 (dev.md section 3 part 1, section 4's CHAT-13 amendment, 'Coherence review' question 1). One shape for what a conversation is about, shared by the hub, the robot and Go: a household reference (an authoritative entity_id - a world subject never becomes a household entity, on any path), a world reference (a real-world thing the household does not own an entity for: a film, an album, a place that is not the household's own), or an unresolved reference (a name the turn could not resolve yet). `TurnContext.subjects: SubjectRef[]` is the stack CHAT-13 keeps (depth two to start); `carried_question` is meaningful only on a stack entry, not on a SubjectRef embedded elsewhere (a TurnSignal clause's `subject`, MEM-06's grounding), where it is always null.",
              ),
          )
          .describe(
            "CHAT-13's stack of what the conversation is about, as it stood after this turn.",
          ),
        z
          .null()
          .describe(
            "CHAT-13's stack of what the conversation is about, as it stood after this turn.",
          ),
      ])
      .describe(
        "CHAT-13's stack of what the conversation is about, as it stood after this turn.",
      )
      .default(null),
    /**The typed outcomes of every package call this turn ran, parked, or rejected. Null for a turn that proposed none.*/
    outcomes: z
      .union([
        z
          .array(
            z
              .object({
                call_id: z.string().min(1),
                package_id: z.string().min(1),
                status: z.enum(["succeeded", "failed", "pending", "rejected"]),
                /**Only meaningful with status rejected.*/
                reason: z
                  .union([
                    z
                      .string()
                      .describe("Only meaningful with status rejected."),
                    z.null().describe("Only meaningful with status rejected."),
                  ])
                  .describe("Only meaningful with status rejected."),
                /**The exact arguments the call was bound to.*/
                args: z
                  .union([
                    z
                      .record(z.string(), z.any())
                      .describe("The exact arguments the call was bound to."),
                    z
                      .null()
                      .describe("The exact arguments the call was bound to."),
                  ])
                  .describe("The exact arguments the call was bound to."),
                /**Which path produced this outcome.*/
                via: z
                  .union([
                    z.literal("tool_call"),
                    z.literal("pattern"),
                    z.literal("confirm"),
                    z.literal("ask"),
                    z.literal("command"),
                    z.literal(null),
                  ])
                  .describe("Which path produced this outcome."),
                at: z.union([z.string().datetime({ offset: true }), z.null()]),
                result: z.union([
                  z
                    .object({
                      reply: z
                        .object({
                          text: z.string(),
                          speech: z.string().optional(),
                        })
                        .strict()
                        .optional(),
                      data: z.any().optional(),
                      synthesis_hint: z.string().optional(),
                      actions: z.array(z.record(z.string(), z.any())),
                      directive: z.record(z.string(), z.any()).optional(),
                      confirm: z
                        .object({
                          prompt: z.string().optional(),
                          on_confirm: z.record(z.string(), z.any()).optional(),
                        })
                        .strict()
                        .optional(),
                      /**Lets a deterministic follow-up match without a model (4.5).*/
                      ask: z
                        .object({
                          prompt: z.string().optional(),
                          expects: z.string().optional(),
                        })
                        .strict()
                        .describe(
                          "Lets a deterministic follow-up match without a model (4.5).",
                        )
                        .optional(),
                      end_conversation: z.boolean().optional(),
                      article: z.record(z.string(), z.any()).optional(),
                      /**Fix B (docs/dev.md's 'Chat reliability: the 2026-09-07 incident' note): a handler's own typed report that it could not answer (an upstream fetch failure, say) - never present alongside `reply`. Distinct from a thrown exception (which the Tier 1 host maps to a strike and the manifest's fallback_reply already): this is a report of an EXPECTED failure mode a handler catches itself, so the caller can answer with the household-facing fallback without treating the package's own sandbox as unhealthy.*/
                      error: z
                        .object({
                          /**One of spec/errors/errors.json's own codes.*/
                          code: z
                            .string()
                            .describe(
                              "One of spec/errors/errors.json's own codes.",
                            ),
                          /**Developer-facing detail, never shown to the household - the household sees the manifest's own fallback_reply or the error catalogue's spoken_fallback instead.*/
                          message: z
                            .string()
                            .describe(
                              "Developer-facing detail, never shown to the household - the household sees the manifest's own fallback_reply or the error catalogue's spoken_fallback instead.",
                            ),
                        })
                        .strict()
                        .describe(
                          "Fix B (docs/dev.md's 'Chat reliability: the 2026-09-07 incident' note): a handler's own typed report that it could not answer (an upstream fetch failure, say) - never present alongside `reply`. Distinct from a thrown exception (which the Tier 1 host maps to a strike and the manifest's fallback_reply already): this is a report of an EXPECTED failure mode a handler catches itself, so the caller can answer with the household-facing fallback without treating the package's own sandbox as unhealthy.",
                        )
                        .optional(),
                    })
                    .strict()
                    .describe(
                      "What a package's handle() (or a recipe's interpreted run) returns. See platform plan 4.9.",
                    ),
                  z.null(),
                ]),
                error_code: z.union([z.string(), z.null()]),
                /**Safe for the household; never a developer diagnostic.*/
                user_message: z
                  .union([
                    z
                      .string()
                      .describe(
                        "Safe for the household; never a developer diagnostic.",
                      ),
                    z
                      .null()
                      .describe(
                        "Safe for the household; never a developer diagnostic.",
                      ),
                  ])
                  .describe(
                    "Safe for the household; never a developer diagnostic.",
                  ),
                source: z.union([
                  z
                    .object({
                      title: z.string(),
                      url: z.string().optional(),
                      site: z.string().optional(),
                      snippet: z.union([z.string(), z.null()]).optional(),
                    })
                    .strict(),
                  z.null(),
                ]),
              })
              .strict(),
          )
          .describe(
            "The typed outcomes of every package call this turn ran, parked, or rejected. Null for a turn that proposed none.",
          ),
        z
          .null()
          .describe(
            "The typed outcomes of every package call this turn ran, parked, or rejected. Null for a turn that proposed none.",
          ),
      ])
      .describe(
        "The typed outcomes of every package call this turn ran, parked, or rejected. Null for a turn that proposed none.",
      )
      .default(null),
    /**COMP-01: a linked document this turn produced or referenced, when that exists. Null until COMP-01.*/
    document: z
      .union([
        z
          .string()
          .describe(
            "COMP-01: a linked document this turn produced or referenced, when that exists. Null until COMP-01.",
          ),
        z
          .null()
          .describe(
            "COMP-01: a linked document this turn produced or referenced, when that exists. Null until COMP-01.",
          ),
      ])
      .describe(
        "COMP-01: a linked document this turn produced or referenced, when that exists. Null until COMP-01.",
      )
      .default(null),
    /**REVIEW-01's own TurnReview id, once one exists for this turn. Null until REVIEW-01.*/
    review_id: z
      .union([
        z
          .string()
          .min(1)
          .describe(
            "REVIEW-01's own TurnReview id, once one exists for this turn. Null until REVIEW-01.",
          ),
        z
          .null()
          .describe(
            "REVIEW-01's own TurnReview id, once one exists for this turn. Null until REVIEW-01.",
          ),
      ])
      .describe(
        "REVIEW-01's own TurnReview id, once one exists for this turn. Null until REVIEW-01.",
      )
      .default(null),
    /**AGE-02 (dev.md section 13 part 4, the outside review reconciled): the notification ids this turn raised, so a dedupe check and an audit trail both read the turn record rather than a separate index. Null until AGE-02.*/
    notice_ids: z
      .union([
        z
          .array(z.string().min(1))
          .describe(
            "AGE-02 (dev.md section 13 part 4, the outside review reconciled): the notification ids this turn raised, so a dedupe check and an audit trail both read the turn record rather than a separate index. Null until AGE-02.",
          ),
        z
          .null()
          .describe(
            "AGE-02 (dev.md section 13 part 4, the outside review reconciled): the notification ids this turn raised, so a dedupe check and an audit trail both read the turn record rather than a separate index. Null until AGE-02.",
          ),
      ])
      .describe(
        "AGE-02 (dev.md section 13 part 4, the outside review reconciled): the notification ids this turn raised, so a dedupe check and an audit trail both read the turn record rather than a separate index. Null until AGE-02.",
      )
      .default(null),
    /**What the body knows about who is speaking is evidence, typed on the turn.*/
    speaker_evidence: z
      .union([
        z
          .object({
            person: z.union([
              z.string().regex(new RegExp("^person-[a-z0-9]{6,}$")),
              z.null(),
            ]),
            basis: z.enum([
              "signed_in",
              "voice",
              "face",
              "voice_and_face",
              "claimed",
              "unknown",
            ]),
            level: z.enum(["confirmed", "tentative", "unknown"]),
          })
          .strict()
          .describe(
            "What the body knows about who is speaking is evidence, typed on the turn.",
          ),
        z
          .null()
          .describe(
            "What the body knows about who is speaking is evidence, typed on the turn.",
          ),
      ])
      .describe(
        "What the body knows about who is speaking is evidence, typed on the turn.",
      )
      .default(null),
    /**The body's list of people with a fresh track or a fresh voice in the last thirty seconds, each at its own level.*/
    present: z
      .union([
        z
          .array(
            z
              .object({
                person: z.union([
                  z.string().regex(new RegExp("^person-[a-z0-9]{6,}$")),
                  z.null(),
                ]),
                basis: z.enum([
                  "signed_in",
                  "voice",
                  "face",
                  "voice_and_face",
                  "claimed",
                  "unknown",
                ]),
                level: z.enum(["confirmed", "tentative", "unknown"]),
              })
              .strict(),
          )
          .describe(
            "The body's list of people with a fresh track or a fresh voice in the last thirty seconds, each at its own level.",
          ),
        z
          .null()
          .describe(
            "The body's list of people with a fresh track or a fresh voice in the last thirty seconds, each at its own level.",
          ),
      ])
      .describe(
        "The body's list of people with a fresh track or a fresh voice in the last thirty seconds, each at its own level.",
      )
      .default(null),
    created_at: z.string().datetime({ offset: true }),
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
    "SPEC-01 (dev.md section 12, 'What exists today': 'conversation_turns is hub-internal while the conversation spec says robot turns sync through the hub: a shared turn record is a debt this item pays, because the signal has to live on it'). One completed turn, spec-shaped so the hub and the robot agree on its fields (backend/src/db/schema.ts's own conversationTurns table stays the hub's storage; this is the shape a sync payload and a fixture agree on, additive to what that table already carries - the fields this migration adds are signal, plan, subjects, outcomes typed, document, review_id and notice_ids; ACT-01 onward writes them, no writer yet). `signal` is required (ACT-01 computes it for every turn, package and command turns included, before routing); `plan`, `subjects`, `outcomes`, `document`, `review_id` and `notice_ids` stay null until the items that write them (ACT-03, CHAT-13, existing package handling, COMP-01, REVIEW-01, AGE-02) land.",
  );
export type ConversationTurn = z.infer<typeof ConversationTurn>;
