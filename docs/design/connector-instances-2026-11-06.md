# Connector instances: more than one of the same service (2026-11-06)

Owner direction (2026-11-06): every connector type (Home Assistant, Uptime Kuma, Gitea, Immich, UniFi, Plex and any later one)
supports several instances of the same type where the service allows it. Example: a household with two Uptime Kuma monitors,
or a main house and a cabin on separate Home Assistant servers.

Extends [agentic-build-plan-2026-11-06](../plans/agentic-build-plan-2026-11-06.md) (AGENTIC-BUILD-PLAN-01) and
[smart-home-controls-2026-11-06](smart-home-controls-2026-11-06.md) (SMART-HOME-CONTROLS-01). Reuse check: the `integration`
record (decision 5 of the plan) is the one definition, `lanFetch` is already created per host and port, the house registry
cache is already keyed to the connection, and `grants` already take a target string. No new store, no new tool, no new route
family.

## 1. The shape

One `integration` record per instance, not one per type: `type` (`home_assistant`, `uptime_kuma`, `gitea`, `immich`, `unifi`,
`plex`), `instance` (a short slug, unique within the type, chosen once, never reused), `label` (what people call it: "Cabin"),
address, credential reference, enabled, plus the usual id, provenance and clock stamp. The spec change is additive in
`commons` (spec first, then a pin bump); no existing field changes. At most 8 instances per type.

The existing single-instance Home Assistant settings (`home.base_url`, `home.access_token`) become the instance with slug
`default` of type `home_assistant`: read through unchanged until the House settings page writes instances, then migrated once
with the record's provenance showing the migration. Nothing that works today stops working.

## 2. Names, grants and ids

- Every entity or item a connector returns is addressed as `<instance>/<native id>` inside Home (for example
  `default/light.kitchen_ceiling`), so two servers with the same native id never collide in grants, Undo rows, the Rooms page
  or the registry cache.
- Grants keep the existing vocabulary; the target string gains the instance prefix (`house.control:default/area:kitchen`).
  Existing grants without a prefix mean the `default` instance (a read-time rule, no rewrite of stored grants).
- The registry cache, the LAN fetcher, the event subscription and the privacy row are per instance. The privacy row stays one
  row per connector type; it lists the number of instances, never their addresses.

## 3. The tools do not multiply

The tool count does not grow with instances. Each connector tool gains one optional argument, `instance` (a slug from a closed
list built from the speaker's visible instances, rule 1). Resolution:

- Exactly one instance visible: implied, the model sees no `instance` argument at all.
- Several visible: the argument is offered. A name that matches in one instance only resolves there. A name that matches in
  more than one (two "Kitchen ceiling" lights, two monitors called "web") is refused as ambiguous with the instance labels
  named ("the Cabin one or the Main house one"), never guessed. A `find` without `instance` searches all visible instances
  and the result rows carry the instance label.
- A confirm card names the instance only when the household has more than one ("Turn on Ceiling in the Cabin?").

## 4. Settings and pages

Settings, House (and each connector's own settings page) lists instances as rows: label, address, Test, Remove, and Add
instance. The permission grid gains one level above rooms (instance) only when more than one instance exists; with one
instance the screen is unchanged. The Rooms page shows a section per instance when there are several, with the instance label
as the heading, and nothing extra with one.

## 5. Build order

1. SPEC-INSTANCES-01 (S, `commons` first): the additive `integration` fields and the grant target prefix rule; pin bump.
2. CONN-INSTANCES-01 (M): `connectorInstances(type)` helper (list, resolve, per-instance LAN fetcher and cache), the
   `default` instance read-through for the existing Home Assistant keys, the ambiguity rule, tests with two fake servers.
3. Apply to the house tool, Rooms API, House settings (instance rows, Add, Remove) in one follow-up slice.
4. Every new connector (Uptime Kuma first) is built on the helper from its first commit, never single-instance first.

## 6. Supersedes

| Replaced | By |
|---|---|
| Smart-home record "one record per household, id `home_assistant`" (already superseded once for other connectors) | One `integration` record per instance, id from type and slug; the first instance is `default`. |
| Plan decision 5 "one `integration` record" | Unchanged in spirit: one record shape and one store; the count is per instance. |
| Smart-home 2026-10-17 lines 53 to 55: the record carries neither the address nor the token | The record holds the address and an opaque credentials-center reference; the token itself stays only in the credentials center. |
| AGENT-NET-01 and plan rule 7: one admin-only setting holds the exact host and port of a connector | The admin-only Settings, House (and each connector's settings page) writes the per-instance address; one allowed host and port pair per instance, nothing else reachable. |
| Settings keys `home.base_url` and `home.access_token` as the only Home Assistant connection | Read through as the `default` instance, then migrated; the keys stay honoured until the migration has run. |

## 7. Conditions from the architect (CONNECTOR-INSTANCES-01, APPROVED 2026-11-06)

- C2 one grant-target form: one function turns every grant target into its full prefixed form before any comparison, used by
  `personIsGranted` and `effectivePermissions`; new grants are always written with the prefix; tests: a prefixed deny beats an
  unprefixed allow and the reverse. The slug pattern excludes `/` and `:`; a target splits at the first `/` (Gitea's native ids
  are `owner/repo`); the `by_parameter` device class is passed separately, never parsed from the target.
- C3 audit stays clean: no instance slug, label or namespaced id in `toolAudit`, traces, logs or receipt log lines. An Undo row
  holds the namespaced id only as that person's own data.
- C4 (S6) outages: a second instance's outage goes only through the existing surfaces, one Repairs issue per instance through
  `raiseIssue` with the address never shown, plus the Status row HOUSE-03 adds. No new banner, dot or panel.
- C5 (S4, 9, 9b) UI: instance rows (Test, Remove, Add) are settings-area data drawn by `SettingsShell`; the grid's instance
  level is an additive extension of the `matrix` card in `commons`, landed before the Home slice; Rooms page section headings
  use kit primitives; no `className` override and no wrapper.
- C6 (rules 1 and 13): the HOUSE-04 and AGENT-SELECT-01 bench rows include a two-instance fixture (argument shown, an
  ambiguous name refused, `find` across instances).
- C7 visible instance for connectors other than Home Assistant: adults only and an admin-enabled instance; no per-instance
  grant without a vocabulary entry added spec first; rule 0 unchanged (the unknown speaker gets nothing).
- C8 ids: the instance id fits the spec id pattern; removing an instance tombstones it (`deleted_at`) so a slug is never
  reused; the additive fields keep the robot's pinned shape valid (principle 2). The `integration` schema does not exist in
  `commons` yet, so SPEC-INSTANCES-01 creates it with these fields from the start.
