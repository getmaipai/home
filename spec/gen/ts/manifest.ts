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
    /**Required when kind is "companion" (session-a-intelligence.md step 8), unused otherwise. Composed by home/backend/src/lib/persona.ts into the turn engine's identity line and system-prompt fragment: display_name replaces the hardcoded "MaiPai" in "You are {display_name}, ...", the four style dials are the same ones lib/persona.ts already had before companions were packages, and examples is a short few-shot block (legacy's own finding: "the single biggest lever for small-model voice fidelity").*/
    companion: z
      .object({
        display_name: z.string().min(1).max(40),
        pronouns: z.string().min(1).max(20).optional(),
        tagline: z.string().min(1).max(80).optional(),
        /**Short by design: no authoring UI exists yet to keep a longer one consistent with itself turn to turn (docs/dev.md's persona research).*/
        backstory: z
          .string()
          .min(1)
          .max(400)
          .describe(
            "Short by design: no authoring UI exists yet to keep a longer one consistent with itself turn to turn (docs/dev.md's persona research).",
          )
          .optional(),
        interests: z.array(z.string().min(1)).max(8).optional(),
        /**3 to 5 lines in the character's own voice, composed as a few-shot block.*/
        examples: z
          .array(z.string().min(1))
          .min(3)
          .max(5)
          .describe(
            "3 to 5 lines in the character's own voice, composed as a few-shot block.",
          )
          .optional(),
        voice_id: z.string().min(1).optional(),
        formality: z.enum(["casual", "neutral", "formal"]),
        complexity: z.enum(["simple", "standard", "advanced"]),
        engagement: z.enum(["brief", "balanced", "curious"]),
        filler_density: z.enum(["none", "light", "frequent"]),
      })
      .strict()
      .describe(
        'Required when kind is "companion" (session-a-intelligence.md step 8), unused otherwise. Composed by home/backend/src/lib/persona.ts into the turn engine\'s identity line and system-prompt fragment: display_name replaces the hardcoded "MaiPai" in "You are {display_name}, ...", the four style dials are the same ones lib/persona.ts already had before companions were packages, and examples is a short few-shot block (legacy\'s own finding: "the single biggest lever for small-model voice fidelity").',
      )
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
    /**Raises the routing bar (4.5): a consequential plugin needs more confidence before it fires - the model must propose it, gated on the household's own confirmation, never a deterministic auto-fire. A consequential package must never also declare `routing.patterns`: turnEngine.ts's route() only enforces the raised bar on the fuzzy/Tier 2 path, so a literal pattern match would fire it immediately, bypassing confirmation entirely (a real gap found and fixed, session-d-packages-and-store.md step 9 - route() itself now also refuses to treat a consequential manifest's own patterns as live, so a manifest bug here can no longer be the only thing standing between a security domain and skipping confirmation, but the manifest still shouldn't declare one).*/
    consequential: z
      .boolean()
      .describe(
        "Raises the routing bar (4.5): a consequential plugin needs more confidence before it fires - the model must propose it, gated on the household's own confirmation, never a deterministic auto-fire. A consequential package must never also declare `routing.patterns`: turnEngine.ts's route() only enforces the raised bar on the fuzzy/Tier 2 path, so a literal pattern match would fire it immediately, bypassing confirmation entirely (a real gap found and fixed, session-d-packages-and-store.md step 9 - route() itself now also refuses to treat a consequential manifest's own patterns as live, so a manifest bug here can no longer be the only thing standing between a security domain and skipping confirmation, but the manifest still shouldn't declare one).",
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
    /**Notification types this package declares, per docs/NOTIFICATIONS.md - registered into home/backend/src/lib/notificationTypes.ts's shared registry at load (registerPackageNotificationTypes()).*/
    notifications: z
      .array(
        z
          .object({
            /**Namespaced by the package's own id (e.g. `weather.severe_alert`) so two packages can never collide in F's shared registry.*/
            id: z
              .string()
              .regex(new RegExp("^[a-z0-9_.-]+$"))
              .describe(
                "Namespaced by the package's own id (e.g. `weather.severe_alert`) so two packages can never collide in F's shared registry.",
              ),
            level: z.enum(["immediate", "time_sensitive", "passive"]),
            audience: z.enum(["person", "household", "adults"]),
            /**`{var}`-interpolated, per docs/NOTIFICATIONS.md.*/
            template: z
              .string()
              .min(1)
              .describe("`{var}`-interpolated, per docs/NOTIFICATIONS.md."),
            configurable: z.boolean(),
            default_channels: z.array(z.enum(["in_app", "telegram"])).min(1),
          })
          .strict(),
      )
      .describe(
        "Notification types this package declares, per docs/NOTIFICATIONS.md - registered into home/backend/src/lib/notificationTypes.ts's shared registry at load (registerPackageNotificationTypes()).",
      )
      .optional(),
    /**How lib/packageCache.ts (session-d-packages-and-store.md step 3) keys and bounds this package's own cache. `additionalProperties: true` on purpose: a package's `host.fetch` call sites decide their own extra per-entry hints (4.10), this just fixes the ones the cache mechanism itself reads.*/
    cache: z
      .object({
        /**A `{arg}`-interpolated template (e.g. `weather:{place}`) naming one cache entry per distinct call.*/
        key_template: z
          .string()
          .min(1)
          .describe(
            "A `{arg}`-interpolated template (e.g. `weather:{place}`) naming one cache entry per distinct call.",
          )
          .optional(),
        /**Fresh for this long; served straight from cache with no fetch.*/
        ttl_s: z
          .number()
          .int()
          .gte(1)
          .describe(
            "Fresh for this long; served straight from cache with no fetch.",
          )
          .optional(),
        /**Beyond ttl_s but within this, served immediately while a revalidation fetch runs in the background (stale-while-revalidate).*/
        stale_ok_s: z
          .number()
          .int()
          .gte(0)
          .describe(
            "Beyond ttl_s but within this, served immediately while a revalidation fetch runs in the background (stale-while-revalidate).",
          )
          .optional(),
        /**Per-entry size ceiling; a fetch response over this is never cached.*/
        max_bytes: z
          .number()
          .int()
          .gte(1)
          .describe(
            "Per-entry size ceiling; a fetch response over this is never cached.",
          )
          .optional(),
      })
      .catchall(z.any())
      .describe(
        "How lib/packageCache.ts (session-d-packages-and-store.md step 3) keys and bounds this package's own cache. `additionalProperties: true` on purpose: a package's `host.fetch` call sites decide their own extra per-entry hints (4.10), this just fixes the ones the cache mechanism itself reads.",
      )
      .optional(),
    /**A scheduled job that pre-populates this package's cache before anyone asks, so a common answer (the household's own weather) never waits on a live fetch.*/
    warm: z
      .object({
        /**The same `every:<n><m|h|d>` grammar lib/scheduler.ts's core jobs already use.*/
        schedule: z
          .string()
          .regex(new RegExp("^every:[0-9]+(m|h|d)$"))
          .describe(
            "The same `every:<n><m|h|d>` grammar lib/scheduler.ts's core jobs already use.",
          )
          .optional(),
        /**The recipe inputs to warm with, one object per cache entry (e.g. `[{ "place": "household's home place" }]`); resolved against household settings/state at warm time, not stored as literal values here.*/
        keys: z
          .array(z.record(z.string(), z.any()))
          .describe(
            'The recipe inputs to warm with, one object per cache entry (e.g. `[{ "place": "household\'s home place" }]`); resolved against household settings/state at warm time, not stored as literal values here.',
          )
          .optional(),
      })
      .catchall(z.any())
      .describe(
        "A scheduled job that pre-populates this package's cache before anyone asks, so a common answer (the household's own weather) never waits on a live fetch.",
      )
      .optional(),
    /**Setting keys (spec/settings/keys.json ids) whose change should trigger an immediate warm outside `warm.schedule` - e.g. `household.home_place` changing re-warms `weather` right away instead of waiting for the next scheduled tick.*/
    warm_on: z
      .array(z.string().min(1))
      .describe(
        "Setting keys (spec/settings/keys.json ids) whose change should trigger an immediate warm outside `warm.schedule` - e.g. `household.home_place` changing re-warms `weather` right away instead of waiting for the next scheduled tick.",
      )
      .optional(),
    backup: z.enum(["hot", "cold", "exclude"]).optional(),
    background: z.boolean().default(false),
    /**Shell blueprints (6.1): nav entries, pages, right-pane panels, settings sections, commands, quick actions, player hooks, admin sections. `additionalProperties: true` since most of 6.1's own blueprint kinds have no bundled package using them yet (Wave 1's `contributes: []` was a placeholder no package had populated); `widgets` below is the one sub-field session-d-packages-and-store.md step 2 fixes a real shape for, since step 9 ships packages that populate it.*/
    contributes: z
      .object({
        /**wave-2.md's D-to-E contract: `GET /api/widgets` and `GET /api/widgets/:package/:id/data` list and serve these.*/
        widgets: z
          .array(
            z
              .object({
                id: z.string().min(1),
                title: z.string().min(1).max(40),
                size: z.enum(["card", "row"]),
                /**How often Home should re-fetch this widget's data; the data itself still only ever comes from lib/packageCache.ts (step 3's own rule: never a live fetch in the request path).*/
                refresh_s: z
                  .number()
                  .int()
                  .gte(1)
                  .describe(
                    "How often Home should re-fetch this widget's data; the data itself still only ever comes from lib/packageCache.ts (step 3's own rule: never a live fetch in the request path).",
                  ),
                /**Resolved the same way `warm.keys` are - against household settings/state, not literal values in the manifest.*/
                inputs: z
                  .record(z.string(), z.any())
                  .describe(
                    "Resolved the same way `warm.keys` are - against household settings/state, not literal values in the manifest.",
                  )
                  .optional(),
              })
              .strict(),
          )
          .describe(
            "wave-2.md's D-to-E contract: `GET /api/widgets` and `GET /api/widgets/:package/:id/data` list and serve these.",
          )
          .optional(),
      })
      .catchall(z.any())
      .describe(
        "Shell blueprints (6.1): nav entries, pages, right-pane panels, settings sections, commands, quick actions, player hooks, admin sections. `additionalProperties: true` since most of 6.1's own blueprint kinds have no bundled package using them yet (Wave 1's `contributes: []` was a placeholder no package had populated); `widgets` below is the one sub-field session-d-packages-and-store.md step 2 fixes a real shape for, since step 9 ships packages that populate it.",
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
    /**A Tier 1 package's own answer when its Deno process crashes or times out (session-d-packages-and-store.md step 5) - required practically, not just structurally, for a Tier 1 package to clear bronze, since a crash with nothing to say is a dead end for whoever asked.*/
    fallback_reply: z
      .object({ text: z.string().min(1), speech: z.string().min(1).optional() })
      .strict()
      .describe(
        "A Tier 1 package's own answer when its Deno process crashes or times out (session-d-packages-and-store.md step 5) - required practically, not just structurally, for a Tier 1 package to clear bronze, since a crash with nothing to say is a dead end for whoever asked.",
      )
      .optional(),
    /**0: declarative (a recipe or prompt body). 1: Deno code.*/
    tier: z
      .union([z.literal(0), z.literal(1)])
      .describe("0: declarative (a recipe or prompt body). 1: Deno code."),
    /**The smoke test entry, run at install, update, and on a schedule (lib/smoke.ts). `kind: "static"` (loads only), `"recipe_fixture"` + `fixture` (a Tier 0 plugin's own recipe run against a fixture-seeded HostEmulator), or `"deno_test"` (Tier 1, session-d step 5).*/
    smoke: z
      .object({
        kind: z.enum(["static", "recipe_fixture", "deno_test"]),
        /**Path, relative to the package's own directory, to its smoke fixture. Required when kind is "recipe_fixture".*/
        fixture: z
          .string()
          .min(1)
          .describe(
            'Path, relative to the package\'s own directory, to its smoke fixture. Required when kind is "recipe_fixture".',
          )
          .optional(),
      })
      .catchall(z.any())
      .describe(
        'The smoke test entry, run at install, update, and on a schedule (lib/smoke.ts). `kind: "static"` (loads only), `"recipe_fixture"` + `fixture` (a Tier 0 plugin\'s own recipe run against a fixture-seeded HostEmulator), or `"deno_test"` (Tier 1, session-d step 5).',
      )
      .optional(),
    /**wave-2.md's C-to-D contract: typed read queries a package offers beyond its own recipe, for C's Tier 2 tool-calling router to call directly rather than routing a whole turn through this package's `handle`.*/
    exposes: z
      .object({
        queries: z
          .array(
            z
              .object({
                id: z.string().min(1),
                description: z.string().min(1).max(200),
                /**A JSON Schema for this query's arguments.*/
                args: z
                  .any()
                  .describe("A JSON Schema for this query's arguments."),
                /**A JSON Schema for this query's result.*/
                returns: z
                  .any()
                  .describe("A JSON Schema for this query's result."),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .describe(
        "wave-2.md's C-to-D contract: typed read queries a package offers beyond its own recipe, for C's Tier 2 tool-calling router to call directly rather than routing a whole turn through this package's `handle`.",
      )
      .optional(),
    quality_scale: z.enum(["bronze", "silver", "gold"]).optional(),
    /**The release channel this manifest version was published under (session-d step 6's store). A household's own per-package channel *choice* is store-side state, not this field - this is the publisher's declaration of what the version itself is.*/
    channel: z
      .enum(["stable", "beta"])
      .describe(
        "The release channel this manifest version was published under (session-d step 6's store). A household's own per-package channel *choice* is store-side state, not this field - this is the publisher's declaration of what the version itself is.",
      )
      .default("stable"),
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
