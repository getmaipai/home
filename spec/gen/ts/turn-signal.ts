// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/turn-signal.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**SPEC-01 (dev.md section 12, 'The act and the emotion of a turn, and the register they drive'). What kind of turn a person just made and how it felt, computed once by classifyTurnSignal() before the model runs and frozen on the turn (never recomputed later, so the judge and REVIEW-01 read what the engine believed at the time). A value shape, not its own synced row: it is carried on conversation-turn.schema.json's own `signal` field, the one record the hub and the robot both sync. `expressed_emotion` is named for exactly what it is - what the words express - because the engine never states an inferred feeling back to the person as if it knew their inner state.*/
export const TurnSignal = z
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
  );
export type TurnSignal = z.infer<typeof TurnSignal>;
