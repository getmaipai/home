# The Companions app (2026-10-21)

Owner ask (Jesse, 2026-10-21): bring back the Companions app from the earlier hub, where a person browses companions, reads about each
one and sets their default. Rules in [RULES.md](RULES.md) govern; nothing here changes one. Related records:
[robot-companions-2026-10-21.md](robot-companions-2026-10-21.md) (the type rule), backlog COMP-03 and COMP-04.

Evidence: the legacy hub's mirror (`legacy-backups/home-legacy.git`) is not on this machine, so its UI was not read; the design uses
the record in `docs/dev.md` ("Notes for later (companion personas)": a browsing UI, 25 personas, an admin studio) and the shipped code
(`lib/persona.ts`, `lib/robotCompanion.ts`, the companion manifests, `persona.active_id`).

## Decision

A native page pair, not a package app: **`/companions`** (a card gallery) and **`/companions/:id`** (one companion in full). Companions
are data that Home already reads (`PERSONAS`, from the companion packages' manifests), so the app is a read route plus one write.
It is a core catalog entry (All apps, search, pinnable), not a new permanent rail icon, so rule S1's list of permanent entries
does not change. A package app was rejected: its schema pages cannot draw the detail page's voice preview and default button
without a new schema node.

## What it shows

- **Gallery card:** name, one line (`tagline`), the type in plain words (Child, Teen or Adult companion), who can use it, and four dial
  lines (how it talks, word choice, questions back, casual chatter) from the manifest's four dials. A "Your default" badge marks the pick.
- **Detail:** about text (`backstory`), pronouns, interests, the dials, the example lines, the voice with a "Play a sample" button (the
  same preview Settings, Voices uses), and "Set as my default". An owner or admin also sees who uses the companion (people, robots).
- **Admins, on the gallery:** a Robots list, each robot's companion and controls, with a link to Settings, Home, Robot (the existing
  "Companion and controls" card).

## Rules, applied exactly

- **Age:** the robot rule's own function, `companionFits(band, type)`: a child sees and picks child companions, a teen child and teen,
  an adult any. The band is the person's role (`speakerAgeBand`). A companion above the person's type is a 404 on the detail route, so
  it does not leak, and a 403 with a plain sentence on the write. A child never receives an adult or teen companion's text at all.
- **One writer:** "Set as my default" calls the settings writer for `persona.active_id`. `PUT /api/settings` now refuses the same
  violation (guardian writes included), and the turn reads a stored pick above the person's type as the plain default, so a stale value
  cannot loosen anything.
- **Household switch:** `companions.allowed` off for a person gives an empty list with one plain sentence and a 403 on the write.
- **Privacy:** only owners and admins see who uses a companion and the robot list; everyone else sees only their own default.
- **Voice:** the preview id comes from the existing voice resolution (`voiceForSpeech`), so a child or teen never previews a clip voice.
- **Kit and tokens:** kit `Card`, `Badge`, `Avatar`, `Section`, `AsyncState`, `EmptyState`, `Alert`, `Button`; no className that
  changes an Element's shape; no fixed colors; `bun run lint:ui-rules` clean. Phone: one column.
- **No new status UI** (S6): errors use the existing `AsyncState` and `Alert`.

## Out of scope

Authoring companions (the legacy admin studio): backlog COMPANIONS-STUDIO-01.

## Rule check

Rule 0 and the age gates: tightened, never loosened. Rule 9: no wrapper, no className on an Element. S1: no permanent rail change.
Principle 1: one type rule (`companionFits`), one writer (`persona.active_id`). Open choice for Jesse: whether Companions should be
pinned in the rail by default (core catalog entries have no default pin; a pin is one tap in All apps).
