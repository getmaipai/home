# Clock and Reminders, redesigned from the owner's mockups (design, 2026-10-30)

Owner: Jesse. Source: four mockups he drew on 2026-10-30 (Alarms, Timers, World clocks, Lists), stored as
`assets/clock-reminders-2026-10-30/alarms.png`, `timers.png`, `world-clocks.png` and `lists.png`, and described below. His ask:
"research the best modern, sexy design for this, update them, and add any missing features like world clocks as needed."
Builds on [alarm-ring-2026-10-30](alarm-ring-2026-10-30.md), [household-lists-reminders-2026-10-17](household-lists-reminders-2026-10-17.md)
(the Reminders and Clock split is its owner ruling of 2026-10-29) and [agentic-actions-design-2026-10-29](../plans/agentic-actions-design-2026-10-29.md).
Rules in [RULES.md](RULES.md) govern.

## Supersedes

- The look and layout of the Clock app (Alarms and Timers tabs, `frontend/src/apps/clock/`) and of the Reminders app built by
  HOUSEHOLD-01, HOUSEHOLD-03, REMINDERS-01 and CLOCK-01. Their data, routes, gates and API stay.
- The Reminders "Coming up" tab: reminders move to a **Scheduled** smart list in the left column (section 6). The alarms and timers rows
  of the old Coming up page already live in Clock.
- Two earlier lines of the approved agentic-actions note, section 3.8: "an alarm is the same `scheduled_jobs` row family, not a second
  store" and "a repeating alarm uses the schedule forms ROUTINES-01 already owns, building no second recurrence grammar". An `alarm` record
  now holds the alarm's **choices** (days, label, tag, sound, switch) while `scheduled_jobs` stays the **firing mechanism**, one row per enabled
  alarm. The weekly, time-zone-aware next-occurrence function is built **once**, in `backend/src/lib/scheduler.ts`, and ROUTINES-01's weekly
  form reuses it; the ROUTINES-01 and SCHED-02 rows in `docs/BACKLOG.md` are edited in the same commit so there is one definition.
- The old ALARM-03 row (repeating alarms) is **superseded by CLOCK-03** and marked so in `docs/BACKLOG.md`.
- The Reminders "custom lists, rename, delete" slice of HOUSEHOLD-02 moves into REMINDERS-02; HOUSEHOLD-02 is narrowed to sharing a list
  (`shared_with`), filed in `docs/BACKLOG.md` and blocked on its spec tag.

**RULES.md S2 holds as written; no rule changes.** The mockups keep the layout of Apple's apps: macOS Clock's segmented control, alarm rows
with the time, a label and a switch, Apple's running-timer ring, world-clock rows with an offset, and Reminders' left column of smart lists
and lists with counts beside a large list title. The owner's extras (taglines, tag chips, day circles, Quick timers) sit inside that layout.
Two parts of the mockups bend to S2: (a) **the header row**: the app's title and its **+** button go in the shell's one header row (title
left, the app's buttons right, the companion last), not a second header under it; the tagline and the divider stay page content;
(b) **the phone**: Apple Clock's tabs are a bottom tab bar on a phone, so on a phone Clock's tabs sit at the bottom (a kit `tabs` bottom
variant, added to `commons` first if it is missing), while wider screens keep the raised segmented pill at the top.
- **Rules 9 and 9b:** where the kit cannot reach a look (the raised segmented pill, hairline rows, icon tiles, large numerals), the fix is an
  additive variant in `commons` first, never a `className` or Home CSS. Each list's icon tile tint is one of the theme's chart tokens, not a
  fixed colour.

## 1. What the mockups show (the source of truth for the look)

Shared: a dark, quiet page with one soft accent (a sage green in the mockup, which here is the person's **theme primary token**, never a fixed
colour). A segmented pill of tabs at the top left (Alarms, Timers, World clocks; the selected one is raised and the keyboard focus ring
is a clear outline). Under it a page header: a large title, one gentle line of text, and a square accent **+** button at the top right,
then a thin divider. Rows are airy, separated by hairlines, with large numerals and small muted second lines.

- **Alarms** ("Make space for a gentler start."): each row shows the time large with a small AM/PM, a second line "Weekdays · Gentle wake" with a
  small tag chip ("Wake up", "Slow morning"), a row of seven day circles (M T W T F S S; the days it rings are filled), and an on/off
  switch at the right.
- **Timers** ("A little focus, one moment at a time."): a large circular progress ring with the time in the middle (25:00) and the timer's name
  under it (FOCUS SESSION), Start (filled) and Reset (outline) under it; on the right a **Quick timers** list (Tea steep 4 min, A little
  break 10 min, Focus session 25 min, Deep work 45 min) that sets the ring.
- **World clocks** ("Keep your favorite places close."): each row has the city (bold) and country (muted) at the left, the local time large at the
  right with the weekday and date under it. The mockup shows San Francisco, New York, London and Tokyo.
- **Lists** (Reminders): a left column titled Lists with a **+**, each list a tile row with an icon tile, its name and its count (Shopping,
  To-do, Personal, Work, Home), the selected row raised; a quiet footer line ("Keep the little things somewhere safe, so you can stay with the
  moment."). The main column has a small eyebrow (YOUR LIST), the list name large, a tagline ("A few things to pick up"), the date at the right, a
  divider, and an empty state (an icon tile, "Nothing on the list yet", "Add the first thing and we'll keep it here for you."), with the
  composer pinned at the bottom: an "Add an item" field and an accent **Add** button.

## 2. Research (honest about its limits)

A short web pass found these patterns. It read search results only (no page was fetched), so every item below is one source unless it says
otherwise, and none is verified against the vendor's own page:

- Per-alarm label, repeat days, snooze and sound on Apple Clock and Google Clock (search results from several outlets); Samsung alarm groups
  (one source: SamMobile); Alarmy's "gentle wake" volume ramp and wake-up missions (one source: its App Store listing and blog). **Taken:** per-alarm label,
  repeat days, tag, snooze and sound; the mockup's "Gentle wake" is a per-alarm sound choice, the Rise sound with a volume ramp.
- Stopping a timer or alarm from the iOS 26 Lock Screen (one source: Tom's Guide, which calls it a regression); Google moving between a slide and
  buttons for dismiss (one source: Android Authority, a test report). **Taken:** big, plain Done and Snooze buttons (ALARM-07), no slider.
- A World Clock slider showing the time difference between cities in One UI 8.5 (one source: Android Authority). **Taken:** an offset line and a
  Today, Tomorrow or Yesterday marker on each world clock, no slider in this slice.
- Free, offline city to time zone data: the backend already depends on `city-timezones` (MIT, read from the repo, not the web), and the browser's
  `Intl.DateTimeFormat` gives the offset and the local time. **Taken:** no new dependency, no network.
- Todoist and Things parsing a due date from one typed line (blog-level comparisons); Apple's Today and Scheduled smart lists and counts (one source:
  9to5Mac). **Taken:** Today and Scheduled smart lists, counts, and a due time parsed from the quick-add line with the parser Home already has.
- Reduce or remove spinning and bouncing motion under Reduce Motion (Apple App Store Connect help); do not announce a changing value every second
  (Deque, one source). **Taken:** section 7.
- Not found in the pass: evidence on timer rings, presets and "+1 minute" patterns, day and night markers, meeting planners, empty states. Those
  choices below are the owner's mockup and plain judgment, not research.

## 3. Clock

Tabs: **Alarms, Timers, World clocks, Stopwatch** (Stopwatch is added; it is the one tab every phone clock has that the mockup lacks).

**Alarms.** The row from the mockup. Under the header a quiet line, "Next: Weekdays 6:30 AM, in 7 h 12 min", when one is on. The switch turns an
alarm on or off (off keeps it). A row opens an editor sheet (kit `sheet`): time, repeat days, label, tag (Wake up, Slow morning, Custom), sound
(the person's default, any of the six including None, or **Gentle wake**: the Rise sound with a 30 s volume ramp), snooze length, and Delete; the
row's menu has **Skip next** (rings after the next one). **+** opens the same sheet empty. An alarm set by chat ("wake me at 6:30") appears as
a one-time row ("Once · Fri"). The data is the new `alarm` record (section 5), whose next ring is one scheduler job (`alarms.fire`) that
reschedules itself; the alarm dialog, Done and Snooze are ALARM-07's and unchanged.

**Timers.** The ring and the Quick timers list from the mockup. Start schedules a `timers.fire` job (the same one chat uses) and the ring counts
down from its end time; **Reset** cancels it; **+1 min** appears while it runs; **several timers may run at once** and show as small rings under the big
one. The quick timers are the person's own list (the `quick_timer` record, section 5) with the four from the mockup as defaults; **+** adds one (name and
minutes), a row's menu renames or deletes it. No pause in this slice (a one-shot job cannot be paused honestly). The ring is drawn by a kit
progress ring; if the kit has none, a `ProgressRing` Element is added to `commons` first (a tag only Jesse approves) and the page waits for it
rather than hand-drawing one (rule 9).

**World clocks.** The row from the mockup plus an offset line ("3 hours ahead of you", "same time") and a Today / Tomorrow / Yesterday marker, a small
sun or moon glyph by local day or night, and the person's own place pinned first as "Home" when their time zone setting is set. **+** opens a search
(kit `command` or `input` with results) over the offline city data (the existing `/api/places/local-search`); picking adds the place (up to 12); a row's menu removes or moves it. The
time ticks once a minute, never every second.

**Stopwatch.** Start, Stop, Lap, Reset, a lap list, large tabular numerals; all in the browser, no server.

## 4. Reminders

The Lists screen from the mockup with: two **smart lists** at the top of the left column, **Today** (reminders and dated items due today) and
**Scheduled** (everything with a time, reminders first), each with a count; then the person's lists (Shopping, To-do and the custom ones) as icon-tile
rows; **+** creates a list (name, one of a fixed set of icons); a list's menu renames, changes its icon, or deletes (a household list: an adult,
with the existing confirm). The main column is the mockup's, with the list's own tagline (one gentle line per built-in list; custom lists show a
neutral one), the date, the empty state and the composer. An item has a checkbox, its text, and an optional due chip; the composer reads a time
from the line ("milk tomorrow at 5") with the existing parser and sets the item's `due_at`; Done items fold under the list. Gates are the
Household design's, unchanged: a child may add and tick, never delete a household list; an admin sees no other person's own lists. Sharing a list
(`shared_with`) is still HOUSEHOLD-02's and waits for its spec tag.

## 5. Data (spec first, principle 3)

The settings registry holds one atomic value per key, so lists of objects are **records**, not settings keys. All of these land in **one `commons`
spec tag** (Jesse's yes), with the `person` field named as `list.schema.json` names it:

| New record | Shape | Notes |
|---|---|---|
| `alarm` | `{ id, person, time "HH:MM", days [0-6] (empty = once), label, tag, enabled, skip_until, sound (default, one of six, or gentle), snooze_minutes, provenance, hlc }` | the alarm's choices; one `alarms.fire` job per enabled alarm in `scheduled_jobs` fires it |
| `world_place` | `{ id, person, name, country, zone, position, provenance, hlc }`, at most 12 per person | saved world clocks |
| `quick_timer` | `{ id, person, name, minutes, position, provenance, hlc }`; the four from the mockup are created for a person on first use | saved quick timers |
| list `icon` (additive) | an optional field on the `list` record | until the tag, built-in lists have fixed icons and a custom list takes one from the fixed set by name |

**Time zones and recurrence.** The weekly, time-zone-aware next-occurrence function is written once in `backend/src/lib/scheduler.ts` and used by
alarms now and by ROUTINES-01's weekly form later (section Supersedes). Each fired alarm computes its next time and updates its own job row; a
restart fires once. **City search** is the route that already exists, `GET /api/places/local-search` (`searchLocalPlaces` in `gazetteer.ts`, offline,
`city-timezones`), extended additively with `country` and `zone` in each result; its query text is never logged (rule 6a). **Until the tag exists**
the Alarms tab shows today's one-time alarms in the new look (a row per pending `alarms.fire` job, with Done and Snooze); the repeat days, the switch,
the editor sheet and Skip next arrive with the record. Nothing here reads outside the home.

## 6. Where things go

| Was | Becomes |
|---|---|
| Clock Alarms and Timers tabs (CLOCK-01) | the new Alarms and Timers tabs, plus World clocks and Stopwatch |
| Reminders Coming up tab (REMINDERS-01) | the **Scheduled** smart list; `/reminders/coming-up` redirects to `/reminders` |
| `ComingUpRow` | still the row for a one-time alarm, reminder or timer in a list; its Done and Snooze stay the one definition |

## 7. Accessibility, motion, phone

Tabs are a real tablist with arrow keys; each alarm switch has a name ("6:30 AM, weekdays, Wake up, on"); day circles are toggle buttons with
`aria-pressed` and full day names; every target is at least 48 px; colours come from theme tokens at AA contrast in both themes. Under reduced motion the
ring jumps in steps of one second without easing and no tab or sheet animates. The clock numerals are updated silently; the page never announces
each second, and a finished timer is announced once (the ALARM-07 dialog). Phone (S1, S3): the tab pill scrolls horizontally if needed, the Alarms and
World clocks rows stack their second lines, the Timers ring sits above the Quick timers list, and the Lists column is the first screen with a list opening as
the second; the main navigation shows at 360, 402, 874 x 402, 744 and 1440.

## 8. Slices

1. **CLOCK-02:** the shared look (tab pill, page header with title, tagline and +, the row style, tokens) and the Alarms tab for one-time alarms.
2. **CLOCK-03:** the `alarm` record, repeat days, the switch, the editor sheet, Skip next (waits for the spec tag).
3. **CLOCK-04:** Timers with the ring, Start, Reset, +1 min, several at once, Quick timers.
4. **CLOCK-05:** World clocks with city search, offset, day marker and Home.
5. **CLOCK-06:** Stopwatch.
6. **REMINDERS-02:** the Lists look, smart lists Today and Scheduled, create, rename and delete a list, the quick-add due time.

## Legacy verdicts (rule 8)

- The Reminders "Coming up" page: **redesigned** as the Scheduled smart list.
- A pause button on timers: **dropped** until a timer can pause honestly.
- A world clock slider and a meeting planner: **dropped** from this pass (one source, no evidence it earns its place).
