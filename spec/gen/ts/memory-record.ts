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
    /**self: the companion's own memory of itself, not shared with anyone.*/
    scope: z
      .enum(["household", "person", "self"])
      .describe(
        "self: the companion's own memory of itself, not shared with anyone.",
      ),
    /**Required when scope is person; null for household or self scope.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Required when scope is person; null for household or self scope.",
          ),
        z
          .null()
          .describe(
            "Required when scope is person; null for household or self scope.",
          ),
      ])
      .describe(
        "Required when scope is person; null for household or self scope.",
      )
      .optional(),
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
    uses: z.number().int().gte(0),
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
  })
  .strict()
  .describe(
    "The shared shape for Memory, Entity, and Episode (platform plan 3.1 lists them as one row with one field set); record_kind is the discriminator. Embeddings themselves never sync (embedding_space only names the space). See 4.4 for the store's recall and maintenance rules this shape supports.",
  );
export type MemoryRecord = z.infer<typeof MemoryRecord>;
