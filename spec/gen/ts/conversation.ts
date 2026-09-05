// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/conversation.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One chat thread, per person and per surface (platform plan 4.14). Its turns live separately (hub-internal, conversation_turns); this record is the thread itself: title, rolling summary, and lifecycle. See session-a-intelligence.md step 3.*/
export const Conversation = z
  .object({
    id: z.string().regex(new RegExp("^conv-[a-z0-9]{6,}$")),
    /**Whose conversation this is. A conversation is never shared across people.*/
    person: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "Whose conversation this is. A conversation is never shared across people.",
      ),
    /**Matches turnEngine.ts's Surface (4.5): a person may hold one open conversation per surface at a time.*/
    surface: z
      .enum(["chat", "overlay", "pod", "robot", "tv", "phone"])
      .describe(
        "Matches turnEngine.ts's Surface (4.5): a person may hold one open conversation per surface at a time.",
      ),
    /**The companion persona active when this conversation was created (5.4); null before companions exist as packages (step 8).*/
    companion_id: z
      .union([
        z
          .string()
          .describe(
            "The companion persona active when this conversation was created (5.4); null before companions exist as packages (step 8).",
          ),
        z
          .null()
          .describe(
            "The companion persona active when this conversation was created (5.4); null before companions exist as packages (step 8).",
          ),
      ])
      .describe(
        "The companion persona active when this conversation was created (5.4); null before companions exist as packages (step 8).",
      )
      .default(null),
    /**Household-editable; null until set (PATCH /api/conversations/:id).*/
    title: z
      .union([
        z
          .string()
          .max(200)
          .describe(
            "Household-editable; null until set (PATCH /api/conversations/:id).",
          ),
        z
          .null()
          .describe(
            "Household-editable; null until set (PATCH /api/conversations/:id).",
          ),
      ])
      .describe(
        "Household-editable; null until set (PATCH /api/conversations/:id).",
      )
      .default(null),
    status: z.enum(["open", "closed", "deleted"]).default("open"),
    /**The rolling summary of turns that have fallen out of the prompt window (step 3's window/summary rule).*/
    summary: z
      .union([
        z
          .string()
          .describe(
            "The rolling summary of turns that have fallen out of the prompt window (step 3's window/summary rule).",
          ),
        z
          .null()
          .describe(
            "The rolling summary of turns that have fallen out of the prompt window (step 3's window/summary rule).",
          ),
      ])
      .describe(
        "The rolling summary of turns that have fallen out of the prompt window (step 3's window/summary rule).",
      )
      .default(null),
    /**The last conversation_turns id folded into `summary`, so the refresh job knows what's new since then.*/
    summary_through_turn: z
      .union([
        z
          .string()
          .describe(
            "The last conversation_turns id folded into `summary`, so the refresh job knows what's new since then.",
          ),
        z
          .null()
          .describe(
            "The last conversation_turns id folded into `summary`, so the refresh job knows what's new since then.",
          ),
      ])
      .describe(
        "The last conversation_turns id folded into `summary`, so the refresh job knows what's new since then.",
      )
      .default(null),
    /**hub: authoritative on the hub. local: begun on a robot, not yet synced (4.14: 'a chat begun on the robot appears on the phone through the hub... robot turns sync as conversation records'). Mirrors person.schema.json's own source field.*/
    source: z
      .enum(["hub", "local"])
      .describe(
        "hub: authoritative on the hub. local: begun on a robot, not yet synced (4.14: 'a chat begun on the robot appears on the phone through the hub... robot turns sync as conversation records'). Mirrors person.schema.json's own source field.",
      ),
    /**Hybrid logical clock: wall_ms:counter:node (7.3).*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe("Hybrid logical clock: wall_ms:counter:node (7.3)."),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .describe(
    "One chat thread, per person and per surface (platform plan 4.14). Its turns live separately (hub-internal, conversation_turns); this record is the thread itself: title, rolling summary, and lifecycle. See session-a-intelligence.md step 3.",
  );
export type Conversation = z.infer<typeof Conversation>;
