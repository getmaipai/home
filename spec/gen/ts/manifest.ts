// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/manifest.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One manifest format for every package kind (plugin, skill, app, companion, integration, model, wakeword, voice, theme, module). See platform plan 5.1 and .github's docs/PACKAGES.md.*/
export const PackageManifest = z
  .object({
    /**Unique in the catalog. No third-party name in it.*/
    id: z
      .string()
      .regex(new RegExp("^[a-z0-9][a-z0-9_-]{0,63}$"))
      .describe("Unique in the catalog. No third-party name in it."),
    version: z.string().regex(new RegExp("^[0-9]+\\.[0-9]+\\.[0-9]+$")),
    /**A `plugin` is a self-contained, permissioned, installable capability (its own network access, its own recipe.json). A `skill` is plain instructions (a SKILL.md body, Claude-format-compatible) - no permissions, no recipe, composed into the chat model's system prompt when relevant, never runs on its own. See home/docs/dev.md's 'Naming: skill, plugin, command, connector' entry.*/
    kind: z
      .enum([
        "plugin",
        "skill",
        "app",
        "companion",
        "integration",
        "model",
        "wakeword",
        "voice",
        "theme",
        "module",
      ])
      .describe(
        "A `plugin` is a self-contained, permissioned, installable capability (its own network access, its own recipe.json). A `skill` is plain instructions (a SKILL.md body, Claude-format-compatible) - no permissions, no recipe, composed into the chat model's system prompt when relevant, never runs on its own. See home/docs/dev.md's 'Naming: skill, plugin, command, connector' entry.",
      ),
    category: z.enum([
      "Home",
      "Family",
      "Info",
      "Fun",
      "Media",
      "Robot body",
      "Health",
      "Learning",
      "Utilities",
    ]),
    display: z.string().min(1).max(60),
    description: z.string().min(1).max(200),
    author: z.string().min(1),
    license: z.string().min(1),
    homepage: z.string().url().optional(),
    routing: z
      .object({
        /**Five or more, required at bronze (docs/PACKAGES.md).*/
        examples: z
          .array(z.string().min(1))
          .min(5)
          .describe("Five or more, required at bronze (docs/PACKAGES.md).")
          .optional(),
        patterns: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    /**A JSON Schema for this package's call arguments.*/
    args: z
      .any()
      .describe("A JSON Schema for this package's call arguments.")
      .optional(),
    /**Capabilities from the capability vocabulary (spec/vocab/capabilities.json) this package cannot run without.*/
    requires: z
      .array(z.string())
      .describe(
        "Capabilities from the capability vocabulary (spec/vocab/capabilities.json) this package cannot run without.",
      )
      .optional(),
    /**Capabilities that add behavior but are not required.*/
    optional: z
      .array(z.string())
      .describe("Capabilities that add behavior but are not required.")
      .optional(),
    platforms: z.array(z.enum(["home", "bot", "web"])).min(1),
    /**The floor role a person needs to invoke this package.*/
    min_role: z
      .enum(["owner", "admin", "adult", "teen", "child", "guest"])
      .describe("The floor role a person needs to invoke this package."),
    /**Raises the routing bar (4.5): a consequential plugin needs more confidence before it fires.*/
    consequential: z
      .boolean()
      .describe(
        "Raises the routing bar (4.5): a consequential plugin needs more confidence before it fires.",
      ),
    /**Stated offline behavior, required at bronze.*/
    offline: z
      .enum(["full", "degraded", "unavailable"])
      .describe("Stated offline behavior, required at bronze."),
    config: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$")),
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
          ),
      )
      .optional(),
    /**Feeds the generated privacy row (docs/ENGINEERING.md > Privacy). The shape is @maipai/standards' PrivacyRow, imported by $ref (std-v0.2.0).*/
    data_sources: z
      .array(
        z
          .object({
            id: z.string().min(1),
            /**The host or service this connects to, named descriptively (docs/PACKAGES.md, the org's Trademarks rule).*/
            destination: z
              .string()
              .describe(
                "The host or service this connects to, named descriptively (docs/PACKAGES.md, the org's Trademarks rule).",
              ),
            /**The trigger, in plain language: 'on package install', 'each time the family asks for weather', 'once a day at the update check'.*/
            when: z
              .string()
              .describe(
                "The trigger, in plain language: 'on package install', 'each time the family asks for weather', 'once a day at the update check'.",
              ),
            /**What this connection carries, in plain language.*/
            what: z
              .string()
              .describe("What this connection carries, in plain language."),
            /**Who receives it: the named third-party service, or 'nobody, this stays on the LAN'.*/
            who: z
              .string()
              .describe(
                "Who receives it: the named third-party service, or 'nobody, this stays on the LAN'.",
              ),
            /**False only for the handful of core, always-on connections (update checks, the store's signed index); every integration is opt_in: true.*/
            opt_in: z
              .boolean()
              .describe(
                "False only for the handful of core, always-on connections (update checks, the store's signed index); every integration is opt_in: true.",
              ),
            /**How long the destination keeps it, in plain language, or 'unknown, see the service's own policy' when the household does not control it.*/
            retention: z
              .string()
              .describe(
                "How long the destination keeps it, in plain language, or 'unknown, see the service's own policy' when the household does not control it.",
              ),
          })
          .strict()
          .describe(
            "One row of a 'what leaves the house' table: one outbound connection a package declares in its manifest's data_sources[]. The generated privacy page (docs/ENGINEERING.md > Privacy, CLAUDE.md > Privacy architecture) is built entirely from these declarations, never hand-maintained.",
          ),
      )
      .describe(
        "Feeds the generated privacy row (docs/ENGINEERING.md > Privacy). The shape is @maipai/standards' PrivacyRow, imported by $ref (std-v0.2.0).",
      )
      .optional(),
    /**From the fixed permissions enum (spec/vocab/permissions.json).*/
    permissions: z
      .array(z.string())
      .describe(
        "From the fixed permissions enum (spec/vocab/permissions.json).",
      )
      .optional(),
    /**Notification ids this package declares, per docs/NOTIFICATIONS.md.*/
    notifications: z
      .array(z.string())
      .describe(
        "Notification ids this package declares, per docs/NOTIFICATIONS.md.",
      )
      .optional(),
    /**key_template, ttl_s, stale_ok_s, max_bytes, max_age_s, scope, platform overrides (4.10).*/
    cache: z
      .record(z.string(), z.any())
      .describe(
        "key_template, ttl_s, stale_ok_s, max_bytes, max_age_s, scope, platform overrides (4.10).",
      )
      .optional(),
    /**schedule, keys, warm_on (4.10).*/
    warm: z
      .record(z.string(), z.any())
      .describe("schedule, keys, warm_on (4.10).")
      .optional(),
    backup: z.enum(["hot", "cold", "exclude"]).optional(),
    background: z.boolean().default(false),
    /**Shell blueprints (6.1): nav entries, pages, right-pane panels, settings sections, commands, quick actions, player hooks, admin sections.*/
    contributes: z
      .array(z.record(z.string(), z.any()))
      .describe(
        "Shell blueprints (6.1): nav entries, pages, right-pane panels, settings sections, commands, quick actions, player hooks, admin sections.",
      )
      .optional(),
    /**Ids of UI schema page documents this package ships (6.2).*/
    pages: z
      .array(z.string())
      .describe("Ids of UI schema page documents this package ships (6.2).")
      .optional(),
    /**A declared setup flow, the one escape hatch beyond a plain settings form (docs/SETTINGS.md rule 1).*/
    setup: z
      .record(z.string(), z.any())
      .describe(
        "A declared setup flow, the one escape hatch beyond a plain settings form (docs/SETTINGS.md rule 1).",
      )
      .optional(),
    /**For integrations: what this package makes available to others (5.4).*/
    provides: z
      .array(z.string())
      .describe(
        "For integrations: what this package makes available to others (5.4).",
      )
      .optional(),
    /**Minimum hub/robot version this package needs.*/
    min_app: z
      .string()
      .regex(new RegExp("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
      .describe("Minimum hub/robot version this package needs."),
    /**The @maipai/ui ui-v tag this package's UI was built against, if it ships one.*/
    kit_version: z
      .string()
      .describe(
        "The @maipai/ui ui-v tag this package's UI was built against, if it ships one.",
      )
      .optional(),
    /**Default reply shape hints for the router, if any.*/
    reply: z
      .record(z.string(), z.any())
      .describe("Default reply shape hints for the router, if any.")
      .optional(),
    /**Bounds handle(). Defaults per 4.9: 4000 on the robot, 8000 on the hub.*/
    timeout_ms: z
      .number()
      .int()
      .gte(1)
      .describe(
        "Bounds handle(). Defaults per 4.9: 4000 on the robot, 8000 on the hub.",
      )
      .optional(),
    /**0: declarative (a recipe or prompt body). 1: Deno code.*/
    tier: z
      .union([z.literal(0), z.literal(1)])
      .describe("0: declarative (a recipe or prompt body). 1: Deno code."),
    /**The smoke test entry, run at install, update, and on a schedule.*/
    smoke: z
      .record(z.string(), z.any())
      .describe(
        "The smoke test entry, run at install, update, and on a schedule.",
      )
      .optional(),
    quality_scale: z.enum(["bronze", "silver", "gold"]).optional(),
    content_sha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")).optional(),
    signature: z.string().optional(),
    signer: z.string().optional(),
    /**For a package that graduated to its own repo (5.1).*/
    source: z
      .object({
        repo: z.string().optional(),
        ref: z.string().optional(),
        sha: z.string().optional(),
      })
      .strict()
      .describe("For a package that graduated to its own repo (5.1).")
      .optional(),
  })
  .strict()
  .describe(
    "One manifest format for every package kind (plugin, skill, app, companion, integration, model, wakeword, voice, theme, module). See platform plan 5.1 and .github's docs/PACKAGES.md.",
  );
export type PackageManifest = z.infer<typeof PackageManifest>;
