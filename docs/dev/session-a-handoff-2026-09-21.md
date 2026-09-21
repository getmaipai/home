# Session A hand-off, 2026-09-21 (shell-on-shadcndashboard, fresh start)

For the fresh session that takes the shell-on-shadcndashboard program.
The coordinator is the `COORDINATOR` session over cross-session
messages; every item arrives from it and every result goes back to it
as `done <item>` with the commit hash(es), `git show --stat HEAD`,
each command's exit, and the review dispositions. Say `ready` first
and start only on its start message.

**Restart line**: read this file, then
[docs/plans/shell-on-shadcndashboard-2026-09-21.md](../plans/shell-on-shadcndashboard-2026-09-21.md),
and report ready to COORDINATOR.

## The two rules behind this restart

Both landed in `.github` the night of 2026-09-21 (org `CLAUDE.md`
principle 6; `DECISIONS.md`, two entries the same date): no hand-built
UI from now on (a component written by hand where a maintained one
exists is a defect, found in review and replaced, never kept because
it already works), and Home's shell and every non-chat page come from
`shadcndashboard` (github.com/shadcndashboard/shadcndashboard, MIT,
React 19, Vite, Tailwind v4, shadcn/ui on Base UI) used exactly as it
ships, restyled by tokens alone; the chat is assistant-ui Elements,
also used as shipped. Home writes routes, data and copy, never a
component.

## What landed today, on the Radix-kit shell (now retiring)

Four Home UI items plus their captures, all on the old hand-built
shell that the program above replaces - kept here for the record, not
because any of it carries forward as code:

- **HOME-UI-02c** (`ui-v0.4.0`/`spec-v0.1.2`) - two selectable looks
  (Calm, Studio) behind one `ui.look` setting, plus a real fix to the
  rail's collapsed-icon state.
- **HOME-UI-02d** (`ui-v0.4.1`/`0.4.2`) - the phone dashboard's own
  density pass, Conversations folded into Chat as its thread list (the
  design doc's own ruling), and a navigation correction across three
  owner rounds in one item.
- **HOME-UI-02e part one** (`ui-v0.4.3`/`.4`) - the rail geometry
  corrected a second time, after COORDINATOR's own pixel measurement
  of the first "landed" capture found it didn't match the numbers it
  claimed to (the active pill running full-width, the brand tile
  clipped, no gap under the tagline) - a real "measure the capture,
  don't just review the CSS" lesson.
- **HOME-UI-02e part two** (`ui-v0.4.8`) - the four functions the
  retired `ConversationsPage` had that Chat's own thread list was
  missing (admin person-picker over a child's conversations,
  multi-select batch delete and clear-all, pin/unpin, server-side
  message-body search) restored into the merged thread list.
- **HOME-UI-02f** (`ui-v0.4.9`) - the phone header fold: search, theme
  toggle and notifications moved under the avatar's own menu, the
  unread count as a dot on the avatar instead of a separate badge,
  matching the owner's own phone reference exactly.
- **Captures** (`fba4fbb9`) - the rail geometry as it actually landed,
  committed once COORDINATOR's own measurement of HOME-UI-02e part
  one's real output confirmed it matched.

## HOME-UI-03 (Settings), stopped and retired

Started under the 17:43 owner ruling ("Settings, corrected"), then
stopped mid-build once the two rules above landed - a hand-built
Settings shell on the kit is exactly what they retire. Nothing from it
carries forward as code:

- The full implementation diff is saved as
  `data-scratch/patches/home-a2-settings-2026-09-21.patch`, reference
  only, never to be applied.
- The page structure, the four agreed defaults, and two real edge
  cases worth remembering are recorded in
  [docs/dev/session-a-settings-rulings-2026-09-21.md](session-a-settings-rulings-2026-09-21.md) -
  read that before composing Settings from the template's form-layouts
  view (the program's own "Decisions the inventory forced" section
  already points there for the row-pattern source).

## Where the repos stand

**`home-a2`** (the worktree this session's UI work has run in):
working tree clean, matches origin's `main`. Reusable as-is for the
program's step 1 (the `/next` route tree) - no need to recreate it.

**`commons`**: branch `a/settings-redesign` (`ui-v0.4.10`, commit
`ab9b833`) still exists, unmerged into `main`. It added an optional
`groupIds` filter to the kit's `SettingsRenderer` component - a Radix-
kit primitive that retires with the rest of the old shell under the
new program. Leave it as is; do not merge it and do not delete it
without asking. Noted here so it isn't mistaken for stray, unexplained
work by whoever looks at `commons` next.

**`home`**: `main` on origin is `9520cbb9` ("Design: Home's shell on
shadcndashboard and the chat on assistant-ui Elements; the artifacts
evaluation that preceded it"), on `fed2589c` (the Settings-rulings
note above), on `1337e8d3` (HOME-STACK-04a, a different lane). Working
tree clean.

## The record

[docs/plans/shell-on-shadcndashboard-2026-09-21.md](../plans/shell-on-shadcndashboard-2026-09-21.md)
is the actual program: what gets vendored into `commons/ui/src/
dashboard/` and what gets stripped (the demo apps, MSW, Tiptap,
chance, the upsell card, `isPro`, `@iconify/react`), the decisions the
`shadcndashboard` inventory forced (Base UI over Radix, SWR for the
template's own pages, the `react-router` import path, `lucide-react`
only, the style-variant presets as Studio and Calm, Settings composed
from the form-layouts view's row patterns), the visual stand-up behind
`ui.shell.next` as step 1, and the row-by-row wiring checklist as step
2. Start there.
