// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/settings-key.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One entry in the settings registry (spec/settings/keys.json) or a package manifest's config[]. See platform plan 3.2 and .github's docs/SETTINGS.md.*/
export const SettingsKey = z
  .object({
    key: z.string().regex(new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$")),
    scope: z.enum(["household", "person", "device"]),
    /**Home Assistant's selector names (3.2).*/
    selector: z
      .enum([
        "number",
        "select",
        "text",
        "boolean",
        "duration",
        "time",
        "entity",
        "area",
        "person",
        "media",
      ])
      .describe("Home Assistant's selector names (3.2)."),
    /**Selector-specific: min/max for number, a duration unit, an option list for select, and so on. Shape depends on selector.*/
    range: z
      .any()
      .describe(
        "Selector-specific: min/max for number, a duration unit, an option list for select, and so on. Shape depends on selector.",
      )
      .optional(),
    default: z.any(),
    label: z.string().min(1),
    help: z.string().optional(),
    section: z
      .object({
        id: z.string().optional(),
        collapsed: z.boolean().default(false),
        order: z.number().int().optional(),
      })
      .strict()
      .optional(),
    level: z.enum(["basic", "advanced", "expert"]),
    secret: z.boolean().default(false),
    /**Capabilities required for this key to apply.*/
    needs: z
      .array(z.string())
      .describe("Capabilities required for this key to apply.")
      .optional(),
    /**The package, companion, integration, or central page id that renders this key.*/
    lives_in: z
      .string()
      .describe(
        "The package, companion, integration, or central page id that renders this key.",
      ),
    honoured_by: z.array(z.enum(["home", "bot"])).min(1),
  })
  .strict()
  .describe(
    "One entry in the settings registry (spec/settings/keys.json) or a package manifest's config[]. See platform plan 3.2 and .github's docs/SETTINGS.md.",
  );
export type SettingsKey = z.infer<typeof SettingsKey>;
