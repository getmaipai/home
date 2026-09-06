// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/list.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**A household or person's own list: the shopping list, a to-do list, or a custom one (session-d-packages-and-store.md step 8). The frozen D-to-E contract (docs/plans/wave-2.md, 'D to E: the store, widgets, lists'): `{ id, person, scope, kind, title, items: [{ id, text, done, due_at?, created_at }], hlc }`. One hlc for the whole list, not one per item: two people editing the same list concurrently resolve at whole-list granularity, a real, deliberate v1 tradeoff (docs/dev/session-d.md's step 8 entry) rather than a per-item oplog this step doesn't build.*/
export const List = z
  .object({
    /**Stable id, never reused, even after deleted_at is set.*/
    id: z
      .string()
      .regex(new RegExp("^list-[a-z0-9]{6,}$"))
      .describe("Stable id, never reused, even after deleted_at is set."),
    /**Who this list belongs to, following entity.schema.json's own scoping minus its person-mention nuance: a list is either the whole household's (the shared shopping list) or one person's own (their private to-do list).*/
    scope: z
      .enum(["household", "person"])
      .describe(
        "Who this list belongs to, following entity.schema.json's own scoping minus its person-mention nuance: a list is either the whole household's (the shared shopping list) or one person's own (their private to-do list).",
      )
      .default("household"),
    /**Required when scope is person; null for household scope. Same field and same rule as Entity and MemoryRecord. Enforced in validate.ts.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Required when scope is person; null for household scope. Same field and same rule as Entity and MemoryRecord. Enforced in validate.ts.",
          ),
        z
          .null()
          .describe(
            "Required when scope is person; null for household scope. Same field and same rule as Entity and MemoryRecord. Enforced in validate.ts.",
          ),
      ])
      .describe(
        "Required when scope is person; null for household scope. Same field and same rule as Entity and MemoryRecord. Enforced in validate.ts.",
      )
      .default(null),
    /**shopping and todo are each a household's one standing list of that kind (lib/lists.ts finds-or-creates rather than letting a second one exist); custom is a named list a person creates deliberately and may have several of.*/
    kind: z
      .enum(["shopping", "todo", "custom"])
      .describe(
        "shopping and todo are each a household's one standing list of that kind (lib/lists.ts finds-or-creates rather than letting a second one exist); custom is a named list a person creates deliberately and may have several of.",
      ),
    /**What the household calls this list. Defaulted from kind ('Shopping List', 'To-Do List') when not given; required and free-text for kind: custom.*/
    title: z
      .string()
      .min(1)
      .max(120)
      .describe(
        "What the household calls this list. Defaulted from kind ('Shopping List', 'To-Do List') when not given; required and free-text for kind: custom.",
      ),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(new RegExp("^item-[a-z0-9]{6,}$")),
            text: z.string().min(1).max(500),
            done: z.boolean(),
            /**Only meaningful for kind: todo. Not how a reminder or timer is tracked (those are scheduler jobs, session-d-packages-and-store.md step 8's own remind/timer packages, not List records) - this is a plain to-do due date with no notification behavior of its own.*/
            due_at: z
              .union([
                z
                  .string()
                  .datetime({ offset: true })
                  .describe(
                    "Only meaningful for kind: todo. Not how a reminder or timer is tracked (those are scheduler jobs, session-d-packages-and-store.md step 8's own remind/timer packages, not List records) - this is a plain to-do due date with no notification behavior of its own.",
                  ),
                z
                  .null()
                  .describe(
                    "Only meaningful for kind: todo. Not how a reminder or timer is tracked (those are scheduler jobs, session-d-packages-and-store.md step 8's own remind/timer packages, not List records) - this is a plain to-do due date with no notification behavior of its own.",
                  ),
              ])
              .describe(
                "Only meaningful for kind: todo. Not how a reminder or timer is tracked (those are scheduler jobs, session-d-packages-and-store.md step 8's own remind/timer packages, not List records) - this is a plain to-do due date with no notification behavior of its own.",
              )
              .default(null),
            created_at: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .default([]),
    /**Same meaning as person.schema.json's own source: hub is authoritative and replicates; local never syncs.*/
    source: z
      .enum(["hub", "local"])
      .describe(
        "Same meaning as person.schema.json's own source: hub is authoritative and replicates; local never syncs.",
      ),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    /**A tombstone, not a removal - the same reason every other synced record type here uses one instead of a hard delete.*/
    deleted_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "A tombstone, not a removal - the same reason every other synced record type here uses one instead of a hard delete.",
          ),
        z
          .null()
          .describe(
            "A tombstone, not a removal - the same reason every other synced record type here uses one instead of a hard delete.",
          ),
      ])
      .describe(
        "A tombstone, not a removal - the same reason every other synced record type here uses one instead of a hard delete.",
      )
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
    "A household or person's own list: the shopping list, a to-do list, or a custom one (session-d-packages-and-store.md step 8). The frozen D-to-E contract (docs/plans/wave-2.md, 'D to E: the store, widgets, lists'): `{ id, person, scope, kind, title, items: [{ id, text, done, due_at?, created_at }], hlc }`. One hlc for the whole list, not one per item: two people editing the same list concurrently resolve at whole-list granularity, a real, deliberate v1 tradeoff (docs/dev/session-d.md's step 8 entry) rather than a per-item oplog this step doesn't build.",
  );
export type List = z.infer<typeof List>;
