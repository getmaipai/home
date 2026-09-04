// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/person.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**A household member or guest. Core holds the birthdate; packages only ever see age_range, derived server-side and never stored on the record a package can read. See platform plan 3.1 and 4.2.*/
export const Person = z
  .object({
    /**Stable id, never reused, even after deletedAt is set.*/
    id: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe("Stable id, never reused, even after deletedAt is set."),
    display_name: z.string().min(1).max(80),
    /**What a companion calls this person, if different from display_name.*/
    nickname: z
      .union([
        z
          .string()
          .max(80)
          .describe(
            "What a companion calls this person, if different from display_name.",
          ),
        z
          .null()
          .describe(
            "What a companion calls this person, if different from display_name.",
          ),
      ])
      .describe(
        "What a companion calls this person, if different from display_name.",
      )
      .optional(),
    /**Core only. Never present in any shape a package's ctx exposes; packages see age_range on Person derived from this.*/
    birthdate: z
      .union([
        z
          .string()
          .date()
          .describe(
            "Core only. Never present in any shape a package's ctx exposes; packages see age_range on Person derived from this.",
          ),
        z
          .null()
          .describe(
            "Core only. Never present in any shape a package's ctx exposes; packages see age_range on Person derived from this.",
          ),
      ])
      .describe(
        "Core only. Never present in any shape a package's ctx exposes; packages see age_range on Person derived from this.",
      )
      .optional(),
    /**The role ladder (4.2). Two minor bands (teen 13-17, child under 13) so there is no thirteen-year cliff.*/
    role: z
      .enum(["owner", "admin", "adult", "teen", "child", "guest"])
      .describe(
        "The role ladder (4.2). Two minor bands (teen 13-17, child under 13) so there is no thirteen-year cliff.",
      ),
    /**Deterministic seed for a generated avatar; never a photo of a real person by default.*/
    avatar_seed: z
      .string()
      .min(1)
      .describe(
        "Deterministic seed for a generated avatar; never a photo of a real person by default.",
      ),
    /**hub: authoritative on the hub, replicated to robots. local: a robot-only guest, never synced to the hub (4.2's local_only concept for a whole person).*/
    source: z
      .enum(["hub", "local"])
      .describe(
        "hub: authoritative on the hub, replicated to robots. local: a robot-only guest, never synced to the hub (4.2's local_only concept for a whole person).",
      ),
    /**Keeps this person off the overlay network entirely (4.2, 4.12).*/
    local_only: z
      .boolean()
      .describe(
        "Keeps this person off the overlay network entirely (4.2, 4.12).",
      )
      .default(false),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    deleted_at: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .default(null),
  })
  .strict()
  .describe(
    "A household member or guest. Core holds the birthdate; packages only ever see age_range, derived server-side and never stored on the record a package can read. See platform plan 3.1 and 4.2.",
  );
export type Person = z.infer<typeof Person>;
