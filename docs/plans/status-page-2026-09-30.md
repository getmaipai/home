# Status: an always-visible indicator and a standard status page

Design note, 2026-09-30. Coordinator: Sonnet 5.5, at Jesse's direction. Nothing here is built yet.
Supersedes the banner idea (ENGINE-AVAIL-07, stopped uncommitted) and the Restart list mounted on the
AI models page (ENGINE-AVAIL-05a2, which nobody could find). The engine-availability work in
`docs/plans/chat-engine-availability-2026-09-29.md` stays; this note is where its admin surface lives.

## What Jesse asked for

1. A health indicator that is always visible, not a trip into Settings.
2. It leads to a standard status page.
3. On that page an admin can post a note, and the whole home can see reliability over time.
4. Admins also see controls there. Other people do not.
5. No "AI models" section in the menu for this.

## What is true today (verified in source, 2026-09-30)

- The sidebar is vendored data in the UI kit (`sidebaritems.ts`): Home, Chat, Library, Family; Settings and
  Help sit at the rail bottom. No role gating. Engines, Repairs, Performance, "AI models" and the rest are
  routes reached only through the admin "Manage" cards in Settings.
- The header has no slot for a status indicator. The left slot is owned by the page title and the chat bar.
  The right group (search, incognito, bell, profile) takes no children. The sanctioned way to add one is a
  new optional prop on the kit's `Header`/`FullLayout`, the path `showThemeToggle` and `incognito` took,
  followed by a kit tag and a pin bump.
- Nothing records uptime. `engineStats` is a two-hour in-memory ring of CPU and memory. The Repairs table
  keeps only the latest open and close per problem, so it undercounts repeated outages.
- No shared record shape exists for an operator note or an incident (checked the spec schemas).
- `GET /api/health` is open to every signed-in person and already returns the four AI engines plus the
  sidecars (search, library). Restart routes exist for admins (`POST /api/host/engines/{role}/restart`,
  `/api/host/engine/stop`).

## The design

### 1. The indicator (everyone, every page)

A small dot with a short label in the header's right group, before the notification bell: green "All good",
amber "Degraded" (an engine restarting or stalled), red "Something is down". Click goes to `/status`. It
reads `/api/health` on the shared query key and uses the one existing definition of "down"
(`chatAvailability`, generalised per engine), so nothing disagrees about what down means. Needs the kit
change above: an optional `statusIndicator` slot prop on `Header`, threaded through `FullLayout`, tagged in
`commons`, pin bumped in `home`. No edit to vendored files in `home`.

### 2. The status page, `/status` (every signed-in person)

Top to bottom:
- **Overall line**: "Everything is running", or "The Brain isn't running" in plain words.
- **The admin's note**, when one is posted, pinned above the components.
- **Components**: the four AI parts (Brain, Understanding, Memory, Voice), Search, Library, and the hub
  itself. Each row: name, one-line purpose, current state badge, 30-day reliability (a percentage and a
  small bar of 30 daily cells, coloured by that day's worst state).
- **Recent problems**: the last few outages with start, length and plain cause.

Everyone sees this, including teens and children, in the same plain words. No technical detail (no ports or
process ids) on the member view.

### 3. Admin-only, same page

The same page shows admins extra, and it is absent for everyone else (and the routes 403 anyway):
- **Controls** on each component row: Restart (any of the four AI parts; route exists), Stop for the Brain
  (exists), a link to Repairs for the technical detail.
- **Post a note** box, and a Clear button on the current note.

### 4. The note

One active note at a time, plain text, optional expiry ("until 9pm"). Shown at the top of the status page
and, as one line, in the indicator's hover text. An admin posts and clears it. Cleared notes stay in a short
history under Recent problems.

### 5. Reliability history

The hub records a heartbeat every 60 seconds and a row on every component state change (append-only,
90 days kept). Hub downtime is inferred from a heartbeat gap and written at the next boot ("hub was not
running from A to B"). The status API turns rows into per-day worst state and an uptime percentage.
This needs its own table; the Repairs table cannot be the source.

### 6. Where things live afterwards

- The engine Restart list currently mounted on the AI models page (05a2) moves to `/status` (admin controls
  section) and is unmounted from `/models`.
- "AI models" keeps only what is not status: choosing the chat model. It stays a Settings → Household
  card for admins and is not a menu item. Jesse to confirm this reading of "no one should see AI models in
  the menu".
- Settings gets a "Status" link card for everyone (no vendored menu change); the indicator is the main way in.

## Spec first

`StatusNote` and `StatusEvent` are new record shapes (id, provenance, clock stamp, per the no-data-debt
rule). They go in `commons/spec/` first, get a fixture and a tag, then `home` pins them, per `AGENTS.md`
"Pinning". The status API returns computed views, not raw rows.

## Slices, in the order Jesse sees value

| # | Slice | Repo | Size | What Jesse sees |
|---|---|---|---|---|
| A0 | Read-only spike on the OpenStatus blocks (done 2026-09-30: not copied, see Reuse) | none (report) | S | a written verdict |
| A1 | `statusIndicator` slot prop on `Header`/`FullLayout`, kit tag `ui-v0.5.81` | commons | S | nothing yet |
| A1b | Attributed snapshots of Kibo `Status` and Tremor `Tracker` (as `UptimeStrip`) into the kit, NOTICE, kit tag `ui-v0.5.82` | commons | S | nothing yet |
| A2 | Indicator component in the slot; `/status` page with current state of every component; admin Restart/Stop controls moved here; Settings link card; unmount the 05a2 list from `/models` | home | M (two commits) | the dot, the page, working controls |
| A2c | Restyle the banner to the visual target (coloured banner, icon, headline, affected-part chips, incident card from current health); no history needed | home | S | the new banner look |
| B1 | Spec: `StatusNote`, `MaintenanceWindow` (Uptime Kuma columns, Statuspage enum), fixtures, tag | commons | S | nothing yet |
| B2 | Tables, admin routes to post and clear a note and to create, edit and cancel maintenance windows, member read; UI; alarms suppressed inside a window | home | M (two commits) | admin posts a note and a window, everyone sees it |
| C1 | Spec: `StatusEvent`, tag | commons | S | nothing yet |
| C2 | Recorder (heartbeat, transitions, boot gap), 90-day retention, maintenance seconds excluded | home | M | nothing yet |
| C3 | `GET /api/status` history view; 30-day bars and uptime percentages; Recent problems | home | M | the reliability bars |

A first (a real indicator and page, no history), then B, then C. Nothing in A needs a new table.

## Decisions (Jesse answered "yes" to all four recommendations, 2026-09-30)

1. Indicator in the header's right group before the bell (recommended), or in the sidebar footer.
2. No new sidebar entry; the dot is the way in, plus a Settings link card (recommended). A sidebar entry
   would mean editing the vendored menu data.
3. "AI models" stays only as the admin's chat-model picker under Settings → Household, and the engine
   controls move to the status page (recommended); or remove the AI models page altogether.
4. Order A, then B, then C (recommended).

## Scheduled maintenance (added by Jesse, 2026-09-30)

An admin posts a maintenance window: title, description, start, end, and which components it affects.
The page shows it as upcoming, in progress or completed, computed from the clock at read time (not stored).
While a window is in progress, the affected components show "under maintenance" and count as neither up nor
down: they do not turn the indicator red, do not raise a Repair notification, and are excluded from the
uptime percentage. One-off windows shipped first. STATUS-D1 adds recurrence using a stored RFC 5545 RRULE,
the `rrule-temporal` package (MIT), and an optional inclusive end date. The hub derives occurrences in its
local IANA time zone so wall-clock times survive daylight saving changes; no recurrence parser is hand-written.

## Reuse, from the 2026-09-30 survey (do not hand-build what is maintained)

Survey result (licences read from each repo through the GitHub API; the registry blocks' own licence is NOT
yet verified, see slice A0):
- **OpenStatus registry blocks: checked, NOT copied (STATUS-A0, 2026-09-30).** Licence unclear (repo root
  AGPL-3.0, `packages/ui/package.json` MIT, no licence file at that path, no header in the block files), their
  own path aliases, a Radix-based hover card, two new date packages. They stay a layout and data-shape reference;
  if OpenStatus gives a written MIT grant for `packages/ui`, `status-bar`, `status-events` and `status-page-shell`
  become candidates (an optional follow-up: ask them).
- **Permissive shadcn-style copy-in components: found and adopted (wider search, 2026-09-30, prompted by Jesse:
  "we use shadcn ui, there are tons of templates and components").** Each is an attributed snapshot under the
  org's third-party rule (permissive licence, NOTICE entry, source comment, justification in dev docs):
  - **Uptime strip: Tremor Raw `Tracker`** (Apache-2.0, tremorlabs/tremor `src/components/Tracker/Tracker.tsx`),
    adapted as `UptimeStrip`: kit `Tooltip` instead of its Radix hover card (the kit has no hover-card
    primitive), the kit's `cn`, design tokens for the colours. Apache-2.0 licence text travels with the file.
  - **Status badge: Kibo UI `Status`** (MIT, haydenbleasel/kibo `packages/status/index.tsx`): online, offline,
    maintenance, degraded; recoloured to design tokens.
  - **Maintenance date range: shadcn's range `Calendar` + `react-day-picker` v9** (both MIT, dependency route)
    with a time input (openstatusHQ/time-picker, MIT, needs a Tailwind v4 port) in a `Popover`.
  - **Component rows: shadcn `Item`** composed with `Status`; no third-party code.
  - **Built by composition (nothing permissive exists):** the incident and maintenance timeline (upcoming, in
    progress, completed) and the overall page layout, from shadcn `Card`, `Alert`, `Item`. Layout references
    only: OpenStatus `status-page-shell`, shadcn.io `dashboard-status-page` and the changelog status-page block
    Jesse linked (paid "Pro" block, no licence text, Next.js + Framer Motion: reference, never copied).
  - Rejected: shadcn.io blocks and shadcnblocks (no licence text; paid tiers), `huybuidac/shadcn-datetime-picker`
    (no licence), Origin UI (AGPL), `@tremor/react` (drags in Tremor's styling system).
- **Maintenance data model: Uptime Kuma** (MIT). Mirror its `maintenance` columns (title, description,
  active, strategy, start_date, end_date, start_time, end_time, weekdays, days_of_month, cron, timezone,
  duration) and its join table to components; derive `scheduled | under-maintenance | ended` from the clock.
  Model only; nothing of the app (Vue, Socket.IO, phones home for updates).
- **Enum names: the Atlassian Statuspage vocabulary** (`operational`, `degraded_performance`,
  `partial_outage`, `major_outage`, `under_maintenance`), mirrored after checking the real docs (the survey
  could not confirm the field lists).
- **Recurring windows, if ever: `rrule-temporal`** (MIT). Not `rrule` (stale), not `ical.js` (MPL).
- **Rejected:** every whole status app (Uptime Kuma, Kener, Gatus, Checkmate, Cachet, OneUptime, Upptime,
  OpenStatus itself): separate services, wrong stack, stale, unverified licence, or phone-home;
  `@openstatus/react` and `@openstatus/sdk-node` (call openstatus.dev).

## Visual target (Jesse, 2026-09-30, two incident.io status page examples)

The finished page should look like a modern hosted status page, not a plain list. From Jesse's screenshots:
- **Banner**: a full-width coloured banner with an icon and a headline. Green with a check: "We're fully operational" and a
  subline ("We're not aware of any issues affecting our systems"). Red with a warning icon: "We're currently experiencing
  issues", with coloured chips inside it naming the affected parts (red for down, amber for degraded). Blue/violet for
  scheduled maintenance in progress. The headline is a plain sentence; the header dot follows the same colours.
- **Current incident card** (under the banner while something is wrong): a title, a one-sentence plain description, and a
  grey meta line "Investigating . Ongoing for 1 day . Affects Voice and Library". Derived from the recorded outage (C2), not
  authored by hand in the first version; an admin's pinned note already covers hand-written text.
- **System status card**: a header "System status" with a month-range pager (`< Jun 2026 - Sep 2026 >`); one row per part:
  a green check or state icon, the name, a small info icon whose tooltip is the part's one-line purpose, "99.999% uptime" on
  the right, and beneath it a dense strip of about 90 thin daily cells (green fine, yellow degraded, red outage, blue
  maintenance, grey no data). Hover or focus on a day shows a small card: the date, the worst state, and any outage
  or maintenance that day. Uptime percentage = operational time / (total time minus maintenance time).
- Component: the kit `UptimeStrip` (A1b). Its data comes from C3's history view; its cell count and month pager are props.
- Subscribe/notification links from the examples are out of scope (Home has its own notifications).

## Out of scope

Email or push for the note (browser push is ENGINE-AVAIL-06), a public status page outside the home, and a
sidebar red dot.
