# Work order: REFERENCE-LIBRARY-01, for B (getmaipai-db)

Ready handshake first, per the coordinate skill: model, checkout/branch,
assignment in one line. Work starts only after "start".

## Lane

Your own worktree, fresh branch from `origin/main` (KIWIX-SIDECAR-01 and
its docs are both on main now: 4eb38876, c9c8b576). Files owned: the
new library-manager module (name it, mirror `kiwixSidecar.ts`'s own
shape), `backend/src/lib/privacy.ts`, `backend/src/routes/storage.ts`
and whatever wizard/settings page shows disk impact for a choice like
this (find it - see "Open question" below), `docs/BACKLOG.md` line 147,
`docs/dev.md` new section. Forbidden: `backend/src/lib/kiwixSidecar.ts`
and `kiwixCatalog.ts` themselves (read them, don't touch them unless a
real defect in KIWIX-SIDECAR-01's own code blocks you - if so, stop and
report rather than fix it inline), anything under `turnMachine/` (A's
lane).

## Item: REFERENCE-LIBRARY-01 (docs/BACKLOG.md line 147)

> install a reference package end to end

Design: `docs/plans/knowledge-sources-2026-09-24.md`, "Packages and
Home" and "Build order" item 3, plus "The owner's calls" 1 and 2
(sizing is proposed not fixed, the person picks the drive/folder,
Home's data folder is only the default).

**The library manager** (Home-side machinery, one of the two
exceptions to "every source is a catalog package" per the design's own
"Home stays lean" rule): find the newest file for a chosen flavour
(you already built this in `kiwixCatalog.ts` - reuse it, don't
reinvent), download it with resume, verify against Kiwix's published
SHA-256 (the exact pattern you just built for the kiwix-tools binary
in KIWIX-SIDECAR-01 - mirror it for a ZIM file, which is much larger,
so resume matters more here than it did there), and on an update keep
the old copy in place until the new one verifies, then swap. A hash
failure is a clear repair-list message, never a silent retry loop or a
corrupt file left in place (mirror KIWIX-SIDECAR-01's "validate a new
file in a separate process before it joins the library" - same
principle, a ZIM applies).

**Updates rows**: `frontend/src/apps/settings/UpdatesSection.tsx` and
`frontend/src/next/pages/NextUpdatesPage.tsx` are the existing pattern
for a pending-update row - a reference set's own update (Kiwix ships a
new snapshot date) shows there the same way an engine or model update
does. Read both files' existing row shape before adding a new kind
rather than inventing a second shape.

**Disk impact**: `backend/src/lib/storage.ts` and
`backend/src/routes/storage.ts` already compute free space; a reference
set's install/add flow shows the size impact before committing, per
owner's call 1 ("Home measures the chosen drive's free space...
recommends a flavour and bundle with the size impact shown, and the
person can pick another"). **Open question, not yet resolved by me:**
I didn't find an existing "wizard" UI for this household to add a
reference set to - the design's own "Build order" places
`REFERENCE-APP-01` (the actual catalog app, the reader) several items
later, after `LOOKUP-FED-01`. So this item's own UI surface is
probably a lighter settings/library page, not the full Reference app.
Confirm this reading against `docs/dev.md`'s "Reference app" build
order before designing new UI; if genuinely ambiguous after that,
dispatch `design-resolver` rather than asking me - this is exactly the
kind of "which of these two readings did we mean" question it exists
for.

**Privacy rows**: `backend/src/lib/privacy.ts` is the existing
registry. Add: "a reference set download or update check sends the
file name and this household's address to Kiwix and a third-party
mirror" (verbatim from the design's own Privacy paragraph). kiwix-serve
itself already sends nothing (KIWIX-SIDECAR-01's own row, unchanged);
only the download/check step is new here.

**Person/child rules**: default for a child is Vikidia and no image
pages (owner's call 5) - a person-scope setting, same shape as
`SEARCH-SAFE-01`'s own per-person setting (B's own prior work, same
pattern).

## Steps

1. Read `kiwixCatalog.ts`, `kiwixSidecar.ts` and their tests in full
   (you just wrote them) before designing the library manager, so the
   flavour-resolution and validation logic is reused, not duplicated.
2. Resolve the wizard/UI open question above before writing frontend
   code.
3. Build the library manager: download+resume+verify+update-with-old-
   kept, a hash-failure repair message, tests in the item's own words.
4. Wire Updates rows, disk impact, privacy rows, the child default.
5. Docs (BACKLOG tick, dev.md section) in the same commit.

## Acceptance evidence

A real flavour installed end to end against a real pinned URL (mirror
KIWIX-SIDECAR-01's own live bench discipline - never vendor the test
fixture, download it from its own pinned URL+sha256 in the bench, per
"download, don't vendor"); a resume proven by interrupting a download
mid-stream and confirming it continues rather than restarting; a hash
failure proven with a corrupted byte and confirming the repair message,
not a crash or a silent pass; the old copy still serving through an
update until the new one verifies, proven live.

## Exit checks

`bash scripts/check.sh` (full scope). Code review at medium (a
download/verification path with real network and disk side effects),
target `main...HEAD` in your worktree. Stage by name, one commit, docs
in the same commit. Push after verified.

## Reporting

Ready / done / blocked / question / low-context, per the coordinate
skill.
