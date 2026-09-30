# Settings redesign: a short, modern Me, and a Household that groups its pages

Design note, 2026-09-30. Decided by the coordinator on Jesse's standing instruction ("get us a modern
design", "a lot of settings under Me don't make sense, most users only have a few settings like appearance",
"user face enrollment and user profile editing should be here"). Builds on `../.github/docs/SETTINGS.md`
(rules 2, 4, 6), `docs/plans/people-profile-2026-09-26.md`, and the BACKLOG items "Rebuild Settings as a real
settings editor", FACE-02H and "Selector renderers so the custom sections can become declared keys".

## What is wrong today (verified 2026-09-30)

- A non-admin's Me tab shows 35 setting rows across 7 cards plus 5 link cards. Most are not "mine":
  - 9 `allowance.*.daily_minutes` keys are parental limits placed on a person, not a preference of theirs.
  - 16 `notifications.*.telegram` toggles and a chat id, meaningful only to someone using Telegram.
  - 2 storage cap keys, an admin concept.
- Face enrollment is reachable only through a button on the profile page's Overview tab
  (`NextPersonProfilePage.tsx`, route `/people/:id/enroll-face`); profile editing only through a dialog there.
- The Household tab is 5 cards plus 7 link cards with no grouping.
- The renderer (`groupSettings.ts`) groups by `lives_in` only and ignores `section`, `order` and `collapsed`;
  the layouts are hard-coded in `NextSettingsPage.tsx` and `NextManageSection.tsx`.

## Decisions

### Me: five sections, a left list on desktop, a select on phones

Settings keeps its two scopes (Me for everyone, Household for owners and admins, "This device" as today). Inside
Me, a left section list (kit `Tabs` in vertical orientation or the shipped sidebar-style list; desktop) that
becomes a simple select on phones. Sections, in order:

1. **Profile** (the landing section). A profile card: photo, display name, nickname, bio, accent colour,
   editable in place with one Save (the same fields and API as the profile page's Edit dialog, one shared form
   component, one definition). Below it a **Face recognition** card: enrolled or not, when, an Enroll or
   Re-enroll button that opens the existing enrollment page, plus the enrollment-sounds switch that lives with it.
   A child's photo and any field a person may not change show as read-only with "Ask an admin". Birthday is shown
   read-only (only owners and admins can change it, per `people.ts`).
2. **Appearance**: appearance (light, dark, system), look. Two rows. This is the section most people use.
3. **Voice and AI**: speaking voice, personality, safe search, with link cards to Voices and Commands.
4. **Notifications**: what to be told about, on a short list; Telegram (chat id and the per-type toggles) sits
   behind an "Advanced" fold that is shown only when Telegram is configured for this household.
5. **Privacy and data**: link cards to Privacy, my storage usage (read only), and signed-in devices.

Removed from Me: the nine allowance keys (they move to the person's own page, shown only to a parent or admin
who manages that person, under "Limits"), the two storage cap keys (admin: Household, Storage), the reply-stats
switch (advanced, folded inside Appearance), pinned apps and session-lock (expert, already hidden). Nothing an
ordinary person cannot act on is shown, disabled or not (BACKLOG rule: "regular users never see admin settings,
even disabled ones"). No global "show advanced" toggle (recorded owner rule).

### Household: seven grouped sections, same left list

General (system name, timezone and the like), People (Users and Family links, invites), Devices, AI (the chat-model
picker; engine status and controls are on `/status`, not here), Integrations (search, reference library), Storage and
backups, Maintenance (Updates, Repairs, Performance links). Each section holds its keys as cards plus its link
cards; no more than about 15 keys per screen (SETTINGS.md rule 6).

### Look

The shipped shadcndashboard pieces only (org rule): the shipped profile page pattern (header card, section cards
with edit affordances), `Card`, `Tabs`, `Field`, `Switch`, `Select`, `Avatar`, `Item` for link rows, `Separator`.
Wide screens: section list 220 px, content column max 720 px, generous spacing; phones: select on top, single column.
Every save applies live with a quiet confirmation, no page-level Save button except the Profile card.

## Implementation slices (each a Codex item; frontend unless noted)

| # | Slice | What it delivers |
|---|---|---|
| S1 | Shared `ProfileForm` extracted from the profile page's Edit dialog (same fields, same API, tests), used by both | one definition of "edit a person" |
| S2 | Me shell: left section list (desktop) / select (phone), routes `?section=`, sections Appearance and Privacy and data; remove allowance, storage caps from Me | the new frame and the short sections |
| S3 | Me > Profile section: profile card (S1 form) + Face recognition card (status, Enroll, sounds switch); person's profile page gets a link to Settings > Profile and keeps its read view | profile editing and enrollment under Me |
| S4 | Me > Voice and AI and Notifications sections; Telegram folded and shown only when configured | the last two sections |
| S5 | Person page "Limits" card for parents and admins (allowance keys) | allowance leaves Me without being lost |
| S6 | Household shell: left list, seven grouped sections with the existing cards and link cards | Household grouped |
| S7 | Screenshot review (`scripts/screenshot.ts --next-settings-review`), fix, retire dead code (`SETTINGS.md`-obsolete sections, old page bits) | polish and cleanup |

S1 then S2 then S3 (Jesse's asks first), then S4 to S7. FACE-02H is closed by S3.

## Non-goals

Declaration-driven section ordering in the kit renderer (`groupSettings`), pronouns and other new profile fields, a
settings search box. Each is a follow-up with its own design.

## How each slice is verified

Component tests, the gate (which includes the phone-width overflow check), then headless screenshots of the
changed screens at desktop and phone width, opened and judged by the coordinator (org rule) before landing.
