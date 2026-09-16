// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/turn-artifact.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**COMP-01's immutable details document for one assistant turn. The section is built from retained typed outcomes, not model prose. A changed evidence version creates a new revision; an existing revision is never edited in place.*/
export const TurnArtifact = z
  .object({
    /**Stable identity for this document revision. A later revision has a new id.*/
    id: z
      .string()
      .regex(new RegExp("^doc-[a-z0-9]{6,}$"))
      .describe(
        "Stable identity for this document revision. A later revision has a new id.",
      ),
    /**The assistant turn whose retained outcomes produced this document.*/
    turn_id: z
      .string()
      .regex(new RegExp("^turn-[a-z0-9]{6,}$"))
      .describe(
        "The assistant turn whose retained outcomes produced this document.",
      ),
    /**One-based revision number for a living document on the same subject.*/
    revision: z
      .number()
      .int()
      .gte(1)
      .describe(
        "One-based revision number for a living document on the same subject.",
      ),
    /**Stable version of the retained outcome evidence used to build this revision.*/
    evidence_version: z
      .string()
      .min(1)
      .describe(
        "Stable version of the retained outcome evidence used to build this revision.",
      ),
    section: z.any().superRefine((x, ctx) => {
      const schemas = [
        z
          .object({
            type: z.literal("lookup"),
            /**The bounded lookup expression that produced the result list.*/
            query: z
              .string()
              .min(1)
              .describe(
                "The bounded lookup expression that produced the result list.",
              ),
            results: z
              .array(
                z
                  .object({
                    title: z.string().min(1),
                    /**One source-backed line for the result, never a model-authored paragraph.*/
                    line: z
                      .string()
                      .min(1)
                      .describe(
                        "One source-backed line for the result, never a model-authored paragraph.",
                      ),
                    /**The id of a citation in the document's top-level sources array.*/
                    source_id: z
                      .string()
                      .regex(new RegExp("^src-[a-z0-9]{6,}$"))
                      .describe(
                        "The id of a citation in the document's top-level sources array.",
                      ),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
        z.any().superRefine((x, ctx) => {
          const schemas = [
            z
              .object({
                type: z.literal("card"),
                kind: z.literal("film"),
                name: z.string().min(1),
                year: z
                  .union([z.number().int().gte(1888), z.null()])
                  .default(null),
                director: z.union([z.string().min(1), z.null()]).default(null),
                genres: z.array(z.string().min(1)).default([]),
                /**The id of a citation in the document's top-level sources array.*/
                source_id: z
                  .string()
                  .regex(new RegExp("^src-[a-z0-9]{6,}$"))
                  .describe(
                    "The id of a citation in the document's top-level sources array.",
                  ),
              })
              .strict(),
            z
              .object({
                type: z.literal("card"),
                kind: z.literal("person"),
                name: z.string().min(1),
                occupation: z
                  .union([z.string().min(1), z.null()])
                  .default(null),
                known_for: z.array(z.string().min(1)).default([]),
                /**The id of a citation in the document's top-level sources array.*/
                source_id: z
                  .string()
                  .regex(new RegExp("^src-[a-z0-9]{6,}$"))
                  .describe(
                    "The id of a citation in the document's top-level sources array.",
                  ),
              })
              .strict(),
            z
              .object({
                type: z.literal("card"),
                kind: z.literal("place"),
                name: z.string().min(1),
                region: z.union([z.string().min(1), z.null()]).default(null),
                country: z.union([z.string().min(1), z.null()]).default(null),
                /**The id of a citation in the document's top-level sources array.*/
                source_id: z
                  .string()
                  .regex(new RegExp("^src-[a-z0-9]{6,}$"))
                  .describe(
                    "The id of a citation in the document's top-level sources array.",
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
        }),
        z
          .object({
            type: z.literal("procedure"),
            title: z.string().min(1),
            steps: z
              .array(
                z
                  .object({
                    position: z.number().int().gte(1),
                    instruction: z.string().min(1),
                    quantities: z
                      .array(
                        z
                          .object({
                            amount: z.union([z.number(), z.string().min(1)]),
                            unit: z.string().min(1),
                            item: z.string().min(1),
                          })
                          .strict(),
                      )
                      .default([]),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
        z
          .object({
            type: z.literal("comparison"),
            title: z.string().min(1),
            subjects: z
              .array(
                z
                  .object({
                    id: z.string().regex(new RegExp("^subject-[a-z0-9]{6,}$")),
                    name: z.string().min(1),
                  })
                  .strict(),
              )
              .min(2),
            rows: z
              .array(
                z
                  .object({
                    attribute: z.string().min(1),
                    values: z
                      .array(
                        z
                          .object({
                            subject_id: z
                              .string()
                              .regex(new RegExp("^subject-[a-z0-9]{6,}$")),
                            value: z.string().min(1),
                          })
                          .strict(),
                      )
                      .min(2),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
        z
          .object({
            type: z.literal("document"),
            attachment_id: z.string().regex(new RegExp("^att-[a-z0-9]{6,}$")),
            chunks: z
              .array(
                z
                  .object({
                    attachment_id: z
                      .string()
                      .regex(new RegExp("^att-[a-z0-9]{6,}$")),
                    page: z.number().int().gte(1),
                    text: z.string().min(1).max(4000),
                    /**The id of a citation in the document's top-level sources array.*/
                    source_id: z
                      .string()
                      .regex(new RegExp("^src-[a-z0-9]{6,}$"))
                      .describe(
                        "The id of a citation in the document's top-level sources array.",
                      ),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
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
    }),
    /**The citation snapshots available to this document. Child-band delivery strips this list without widening the content ceiling.*/
    sources: z
      .array(
        z
          .object({
            id: z.string().regex(new RegExp("^src-[a-z0-9]{6,}$")),
            /**Which evidence rung this came from: web is the household's own SearXNG; wikidata/wikipedia/weather are the typed lookups CHAT-15 already retains; package is a future catalog package's own citation (its manifest names the site).*/
            kind: z
              .enum(["web", "wikidata", "wikipedia", "weather", "package"])
              .describe(
                "Which evidence rung this came from: web is the household's own SearXNG; wikidata/wikipedia/weather are the typed lookups CHAT-15 already retains; package is a future catalog package's own citation (its manifest names the site).",
              ),
            /**The cited page or result's own title, exactly as the source gave it, never rewritten by the model.*/
            title: z
              .string()
              .min(1)
              .describe(
                "The cited page or result's own title, exactly as the source gave it, never rewritten by the model.",
              ),
            /**Opened directly by the citation chip, rel="noopener noreferrer" and referrerpolicy="no-referrer" on the client (the privacy page's promise: a cited site learns nothing from the click but the click).*/
            url: z
              .string()
              .url()
              .describe(
                'Opened directly by the citation chip, rel="noopener noreferrer" and referrerpolicy="no-referrer" on the client (the privacy page\'s promise: a cited site learns nothing from the click but the click).',
              ),
            /**The hostname a citation chip shows (e.g. "wikipedia.org"), so a household member sees where an answer came from without hovering the link.*/
            site: z
              .string()
              .min(1)
              .describe(
                'The hostname a citation chip shows (e.g. "wikipedia.org"), so a household member sees where an answer came from without hovering the link.',
              ),
            /**The short passage the evidence was drawn from, when the source has one worth showing; null for a source that is just a link (e.g. a typed weather lookup).*/
            snippet: z
              .union([
                z
                  .string()
                  .describe(
                    "The short passage the evidence was drawn from, when the source has one worth showing; null for a source that is just a link (e.g. a typed weather lookup).",
                  ),
                z
                  .null()
                  .describe(
                    "The short passage the evidence was drawn from, when the source has one worth showing; null for a source that is just a link (e.g. a typed weather lookup).",
                  ),
              ])
              .describe(
                "The short passage the evidence was drawn from, when the source has one worth showing; null for a source that is just a link (e.g. a typed weather lookup).",
              )
              .default(null),
            /**Free-text provenance: the turn id this citation was gathered for (mirrors memory-record.schema.json's own 'source' field and naming).*/
            source: z
              .string()
              .min(1)
              .describe(
                "Free-text provenance: the turn id this citation was gathered for (mirrors memory-record.schema.json's own 'source' field and naming).",
              ),
            created_at: z.string().datetime({ offset: true }),
            /**Hybrid logical clock: wall_ms:counter:node (7.3).*/
            hlc: z
              .string()
              .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
              .describe("Hybrid logical clock: wall_ms:counter:node (7.3)."),
          })
          .strict()
          .describe(
            "One citation on an assistant reply: the evidence ladder CHAT-16 phrases factual answers from (media-conversation-program-2026-09-13.md step 4 - a typed source, then websearch, then model knowledge), numbered and rendered as `[N]` markers in the reply text (docs/BACKLOG.md's 'Inline citation markers on sourced answers', the Perplexity-shaped pattern legacy already validated once). Lives on the assistant turn (backend/src/wire.ts's TurnValue, additive when CHAT-16 lands - home is the whole record, no separate hub/robot split for this one), never independently synced or merged, which is why it carries the shared envelope (source, hlc, created_at) but no updated_at: a citation is a snapshot of what was true when the reply was generated, not an editable record.",
          ),
      )
      .min(1)
      .describe(
        "The citation snapshots available to this document. Child-band delivery strips this list without widening the content ceiling.",
      ),
    /**Free-text provenance for the build, such as the composer run or the originating outcome.*/
    provenance: z
      .string()
      .min(1)
      .describe(
        "Free-text provenance for the build, such as the composer run or the originating outcome.",
      ),
    created_at: z.string().datetime({ offset: true }),
    /**Hybrid logical clock: wall_ms:counter:node (7.3).*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe("Hybrid logical clock: wall_ms:counter:node (7.3)."),
  })
  .strict()
  .describe(
    "COMP-01's immutable details document for one assistant turn. The section is built from retained typed outcomes, not model prose. A changed evidence version creates a new revision; an existing revision is never edited in place.",
  );
export type TurnArtifact = z.infer<typeof TurnArtifact>;
