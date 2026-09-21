# Settings rulings, kept as page structure (2026-09-21)

HOME-UI-03 (a hand-built rebuild of the Settings page on the kit) was
stopped mid-item once two owner rules landed in `.github` the same
night (`da28bdc`, `919881b`): no more hand-built UI, and Home's shell
and every non-chat page come from `shadcndashboard`
(github.com/shadcndashboard/shadcndashboard) as shipped, restyled by
tokens only. The hand-built implementation is retired - the full diff
is saved as `data-scratch/patches/home-a2-settings-2026-09-21.patch`
(taken from the `home-a2` worktree, which was then reverted to match
origin) for reference only, never to be applied. This note is the
other half: what a page composed from the template's own form layouts
still needs to satisfy, so the rulings below aren't lost with the code.

The full owner ruling is already recorded in
[docs/design/home-pages-2026-09-20.md](../design/home-pages-2026-09-20.md)
under "Settings, corrected (owner finding 2026-09-20 17:43)" - this
note doesn't repeat it, only the page-structure decisions and defaults
this session worked out on top of it before being stopped.

## The page structure

One section tree, not two. The retired page's predecessor kept
separate Household/Me trees behind a tab switcher; the ruling's own
sections (General, People, Chat, Voice, Engines, Maintenance, Privacy,
Developer) exist once, and the Household/Me switch changes which
scope's *settings* a section shows, not which sections exist - General
already mixes a household group (System) with person groups
(Appearance, notifications) under one heading, so a section-per-scope
split would have split General in two for no reason.

Two kinds of card, not one:

- A section's real CRUD/management surfaces (Users, Models, Backups,
  Voices, Commands, Devices, Repairs, Updates) stay their own routed
  pages, reached from a link-out summary card (icon tile, title, one
  description line) rather than folded inline - a generic settings
  renderer can't draw a things-table or a multi-step flow.
- Plain declared settings (the registry's own keys) render inline
  through the settings renderer, scoped to only the groups that
  section owns.

A section with settings groups but none for the currently active scope
shows a placeholder naming which scope actually has them ("Household
only" / "Yours only") rather than vanishing, so the section list never
jumps under the switch.

Privacy folds in as a section, not a rail item: the "what leaves your
house" list is a things-table (destination/source/when), row click
opens the detail (when / what it sends / who gets it / how long they
keep it / source). `/privacy` redirects to `/settings/privacy`. The
settings-switches half of the ruling has no settings keys behind it
anywhere in the spec yet (checked `spec/settings/keys.json` directly:
zero hits) - real follow-up work, not something to invent under this
item's own scope.

Voice gets a top-choices row above "Browse all voices": up to six real
voices from the Stack's own voice list, a preview button, the current
one marked, picking one sets `tts.voice_id`.

## The four defaults agreed with COORDINATOR

Four real ambiguities came up building this; each was resolved before
building rather than guessed at silently:

1. **Voice's `engine` field isn't real on the Stack's wire yet**
   (checked directly against the pinned tag's
   `stack/backend/src/spec/ts/voice.ts`: the real fields are
   `id`/`name`/`description`/`language`/`country`/`gender`/`source`/
   `onDisk`/`licence`/`revision`, no `engine`). Type it optional ahead
   of the Stack side landing it (`STACK-101b`/`c-97`), render a badge
   from `engine ?? source`, never treat `source`
   (`preset`/`community`/`cloned`) as an engine identifier in its
   place - the row changes nothing once the real field lands.
2. **Privacy's switches have no settings keys yet.** Ship the
   things-table now; the switches are a named follow-up that needs a
   spec pass first (new keys in `spec/settings/keys.json`), not
   invented under this item's own review budget.
3. **Routed-vs-inline card strategy**: real CRUD/management pages stay
   routed, reached by a link-out card; only plain declared settings
   render inline through the generic renderer. Named above, repeated
   here because it's the split a template-composed version needs to
   preserve too - a settings renderer cannot draw Users' or Backups'
   own real surfaces.
4. **Grid/breakpoint convention**: the ruling's own literal numbers
   ("1440", "1024", "32px") are descriptions of the capture that
   produced them, not rules to hit exactly - use whatever density/
   breakpoint tiers the actual component library in use provides
   (the kit's own two tiers, previously; `shadcndashboard`'s own
   layout primitives, going forward) rather than a hand-picked pixel
   value. Confirmed twice this session on two different specifics (the
   card grid's own column count, and later the Household/Me control's
   height) - COORDINATOR's own words: "a description of the capture,
   not a rule."

## Two edge cases worth carrying forward

Both were real bugs, not style nits, caught by the screenshot
pipeline's own automated checks (not visible by eye in a full-page
screenshot, which crops horizontal overflow at the viewport's own
width):

- **A settings form row needs real width.** A label-plus-fixed-width-
  control row (a number input, a select) genuinely overflows if
  squeezed into a narrow grid column - a settings group belongs in a
  full-width stack, not a multi-column card grid, even though the
  section's own link-out cards (icon tile, title, one line) are
  exactly the right shape for one. Tried merging both into one grid
  once; it broke real rows at tablet/laptop/desktop widths.
- **A grouped toggle/segmented control needs an explicit minimum
  width**, not just a "large enough" size variant, when the group
  cancels its item's own compact-size hit-area extension to stop
  adjacent items' invisible tap zones from overlapping (a real,
  deliberate trade-off, not a bug in the primitive) - a short label
  ("Me") can still land a hair under the 48px floor on content width
  alone even at the "default" size.

## What's left behind

- `data-scratch/patches/home-a2-settings-2026-09-21.patch`: the full,
  now-retired implementation, for reference only.
- `commons`: branch `a/settings-redesign` (`ui-v0.4.10`, commit
  `ab9b833`) added an optional `groupIds` filter to the kit's
  `SettingsRenderer`, tagged and pushed but never fast-forwarded to
  `main`. Whether a `SettingsRenderer`-shaped primitive has any place
  in a `shadcndashboard`-composed Settings page is an open question for
  whoever writes that design record - flagged, not decided here.
