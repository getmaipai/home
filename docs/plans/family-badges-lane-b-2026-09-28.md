# FAMILY-BADGES-01: count badges on the Family page's tabs

Lane: codex-b, worktree `~/Developer/github.com/getmaipai/home-codex-2`. Model
floor: Codex, low reasoning (mechanical, the design call is already made).

## Ready handshake

Report ready (model, checkout, branch, "ready for FAMILY-BADGES-01"), wait
for "start".

## Why

Jesse asked (2026-09-28) whether People/Pets/Bots should show a count next
to the title, like the notification bell's badge. Research (already done,
not yours to redo): use the shipped `Badge` primitive
(`@maipai/ui/src/dashboard/components/ui/badge`, already used the same way
in `Notifications.tsx`'s dropdown body and imported elsewhere in this repo's
`NextChatPage.tsx`), not a hand-rolled count. Tabs stay tabs (no change to
the People/Pets/Bots grouping itself, that question was separately
resolved to keep the current structure).

## Files you own

`~/Developer/github.com/getmaipai/home-codex-2` (your own worktree, already
on `main` from FAMILY-TABS-01 landing):
- `frontend/src/next/pages/NextFamilyPage.tsx`
- its test file (`NextFamilyPage.test.tsx`)

Nothing else. Don't touch `commons`, `scripts/`, or any pin.

## Setup

`cd ~/Developer/github.com/getmaipai/home-codex-2 && git status` (confirm
clean) `&& git fetch origin && git merge --ff-only origin/main` (pulls in
anything landed since your last commit, including this plan file).

## Steps

1. Read the current `NextFamilyPage.tsx` you just built. The three queries
   (`peopleQuery`/`rosterQuery`, check its actual name, , `petsQuery`,
   `botsQuery`) currently gate `petsQuery`/`botsQuery` with `enabled:
   activeTab === "pets"` / `"bots"` (lazy, only the open tab fetches).
   Remove that gate so all three fetch eagerly on mount (the People query
   already does; drop `enabled` from the other two, or set it to always
   true, whichever reads cleaner against the existing code). These are
   small collections (a handful of people, a few pets, a couple of bots at
   most), eager fetch is cheap and is the whole point of showing a count
   without a click. Keep the existing role gate on the Bots trigger/tab
   itself unchanged (don't fetch bots data for a non-admin viewer, check
   `isOwnerOrAdminRole` still gates the query's `enabled`, just not on
   `activeTab` anymore, so a non-admin's `botsQuery` should stay disabled
   entirely, not just hidden).
2. Add a `Badge` (import from `@maipai/ui/src/dashboard/components/ui/badge`,
   mirror exactly how `Notifications.tsx` line ~56 or `NextChatPage.tsx`
   line ~37 already import and use it, same package, same component, no
   new primitive) next to each `TabsTrigger`'s label: `People
   <Badge>{count}</Badge>`, `Pets <Badge>{count}</Badge>`, and `Bots
   <Badge>{count}</Badge>` (only when the Bots trigger itself is rendered,
   i.e. admin/owner). Count is each query's `data?.length ?? 0` while
   loading (don't show a badge with a stale or wrong number while the
   query is in flight, either omit the badge until `data` exists, or show
   it once available; match whatever's simplest given `AsyncState`'s own
   loading convention already used elsewhere on this page). Keep the
   badges small and inline with the label, check `Badge`'s own default
   size/variant renders reasonably next to short text like "People"; use
   a smaller variant only if the default one looks obviously oversized
   next to the existing tab label styling (`min-h-12 min-w-12` etc.), 
   judge this from a real screenshot, not by assumption.
3. Update `NextFamilyPage.test.tsx`: existing tests that assert on tab
   label text (e.g. `getByRole("tab", { name: "People" })`) may need their
   matcher loosened (a regex or `{ name: /People/ }`) once a badge number
   is appended to the accessible name, check and fix any that break.
   Add one test asserting a badge shows the right count for at least one
   tab (Pets or Bots) using the existing entity/device fixture pattern
   already in that file.

## Acceptance evidence

- A real screenshot: start `bun run dev` in `frontend/` (or reuse
  whatever the existing screenshot script/dev-server convention in this
  repo already does, check `scripts/screenshot.ts` for an existing Family
  capture from FAMILY-TABS-01 to extend, since a "Family-tab screenshots
  are a follow-up" comment was left there), navigate to `/people`, and
  confirm visually that People/Pets/Bots each show a correct count badge,
  legible and not visually broken against the tab label. Open and judge
  the image yourself before reporting done, don't just assert the code
  compiles.
- `bun test src/next/pages/NextFamilyPage.test.tsx` green, including the
  new badge-count test.
- `bash scripts/check.sh` green, scope noted.

## Exit checks

- `bash scripts/check.sh` green (paste it).
- Code review at `low` effort (a small, mechanical UI addition to a file
  already reviewed at medium for FAMILY-TABS-01) with an explicit target
  (`main...HEAD` in your worktree).
- One commit, staged by name (`NextFamilyPage.tsx`, its test file, list
  them explicitly).
- Push once green.

## Reporting

Ready, then wait for start. Done: commit hash, check.sh pass line, the
screenshot path and what it shows, test results. Blocked: exact error.
Question: only if `Badge`'s import path or the query's `enabled` structure
turns out different from what's described above and the right fix isn't
obvious from the existing code around it.
