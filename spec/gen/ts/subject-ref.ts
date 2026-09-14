// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/subject-ref.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**SPEC-01, folded in from ASK-01 and CHAT-13's own design by the coherence review, 2026-09-14 (dev.md section 3 part 1, section 4's CHAT-13 amendment, 'Coherence review' question 1). One shape for what a conversation is about, shared by the hub, the robot and Go: a household reference (an authoritative entity_id - a world subject never becomes a household entity, on any path), a world reference (a real-world thing the household does not own an entity for: a film, an album, a place that is not the household's own), or an unresolved reference (a name the turn could not resolve yet). `TurnContext.subjects: SubjectRef[]` is the stack CHAT-13 keeps (depth two to start); `carried_question` is meaningful only on a stack entry, not on a SubjectRef embedded elsewhere (a TurnSignal clause's `subject`, MEM-06's grounding), where it is always null.*/
export const SubjectRef = z
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
            )
            .default(null),
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
          year: z.union([z.number().int(), z.null()]).default(null),
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
            )
            .default(null),
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
            )
            .default(null),
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
            )
            .default(null),
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
            .array(z.enum(["person", "pet", "place", "organization", "thing"]))
            .min(0)
            .describe(
              "ASK-01's own hint: entity.schema.json kinds this name plausibly refers to, read from a relation phrase's noun via vocab/entity-kind-nouns.json. Empty when nothing hinted a kind.",
            )
            .default([]),
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
            )
            .default(null),
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
                "Invalid input: Should pass single schema. Passed " + passed,
            }
          : {
              path: [],
              code: "custom",
              errors: [errors],
              message:
                "Invalid input: Should pass single schema. Passed " + passed,
            },
      );
    }
  })
  .describe(
    "SPEC-01, folded in from ASK-01 and CHAT-13's own design by the coherence review, 2026-09-14 (dev.md section 3 part 1, section 4's CHAT-13 amendment, 'Coherence review' question 1). One shape for what a conversation is about, shared by the hub, the robot and Go: a household reference (an authoritative entity_id - a world subject never becomes a household entity, on any path), a world reference (a real-world thing the household does not own an entity for: a film, an album, a place that is not the household's own), or an unresolved reference (a name the turn could not resolve yet). `TurnContext.subjects: SubjectRef[]` is the stack CHAT-13 keeps (depth two to start); `carried_question` is meaningful only on a stack entry, not on a SubjectRef embedded elsewhere (a TurnSignal clause's `subject`, MEM-06's grounding), where it is always null.",
  );
export type SubjectRef = z.infer<typeof SubjectRef>;
