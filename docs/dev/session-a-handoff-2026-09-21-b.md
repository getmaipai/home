# Session A hand-off, 2026-09-21-b (CHAT-SDK-01)

For the fresh session that takes CHAT-SDK-01. The coordinator is the
`COORDINATOR` session over cross-session messages. Say `ready` first
and start only on its start message.

**Restart line**: read this file, then
[docs/plans/shell-on-shadcndashboard-2026-09-21.md](../plans/shell-on-shadcndashboard-2026-09-21.md)'s
wiring table (the `/next/chat` row), then
`../../commons-a/ui/docs/dashboard-upstream.md`'s "A real version-skew
risk did surface" section for the full mechanical trail of what's
already been tried and ruled out.

## What just landed (HOME-UI-04a, step 1's captures)

Two commits on `home-a2` (worktree, branch `a/settings-redesign`):

- `3401ecb5` - re-pinned `@maipai/ui` to `ui-v0.5.6` (the sidebar CSS
  fix and the second missed Buy Now upsell removal); wired `ui.look`
  into `/next` via a new `useNextLook`, sharing `useLook`'s resolution
  (`useLookValue`, `@/shell/useLook.ts`) rather than duplicating the
  query/type/guard - a review finding, fixed before commit; and fixed
  a real screenshot-capture bug in `scripts/screenshot.ts`
  (`captureNextStandup`): `FullLayout`'s header is `sticky top-0`, and
  Chromium's `fullPage: true` capture stitches tall pages by
  scrolling, which re-paints the sticky header mid-stitch and ghosts
  whatever was behind it (the footer's copyright line bled into the
  Tables page's dark-desktop title bar, found live by opening the
  captures). Fixed by resizing to the page's real `scrollHeight` and
  taking a plain screenshot instead - avoids the stitch entirely, no
  app-code change was needed.
- `93fb414d` - the 40 acceptance captures themselves
  (`docs/assets/screens/next-standup/`), each opened and judged before
  the commit.

Full `scripts/check.sh` is green on `3401ecb5` (502 frontend tests
pass, tsc/eslint clean, build clean). `--docs` is green on `93fb414d`.
Neither commit is pushed or merged to `main` yet - that's the
integrator's call, not this session's.

**How Jesse looks at it today**: `ui.shell.next` (`backend/src/
settings/uiKeys.ts`) is household-scoped, `level: "expert"`,
`lives_in: "household.system"` - it renders automatically in the real
Settings page (Settings > System, the "General" group,
`frontend/src/apps/settings/SettingsPage.tsx`) via the generic
renderer, once expert-level settings are visible for his account. No
UI wiring was skipped; this is the one definition, one renderer.
Toggling it on there flips `/next` live for the household. The direct
API form, if expert level isn't surfaced yet:
`PUT /api/settings` with body
`{"scope":"household","key":"ui.shell.next","value":true}`.

Port 8787 is already held by a separate, long-running process outside
`home-a2` (a different checkout's own dev server) - not this session's
to restart. Whatever server Jesse actually looks at, it needs this
branch merged to `main` first; the two commits above are ready for
that merge.

## CHAT-SDK-01: the coordinated assistant-ui upgrade

The actual item, unstarted. Summary of the trail already walked (full
detail in `dashboard-upstream.md`, `ui/CHANGELOG.md`'s `0.5.1`-`0.5.4`
entries):

- The vendored Elements (`ui/src/elements/`, `thread.aui.tsx` etc.)
  read `message.metadata.modality`, a field `@assistant-ui/core` added
  after the `0.3.17` that `@assistant-ui/react@0.15.18` (the kit's
  current pin, matching what Home's real `ChatPage.tsx` already ships)
  was built against.
- Bumping `@assistant-ui/react` inside the kit alone doesn't work: the
  kit already ships its own hand-built wrapper components
  (`ui/src/assistant-ui/`, predating this program, in production use
  by Home's real chat) that share ONE nested `@assistant-ui/react`
  resolution with every other file in the kit. Bumping it for the new
  Elements silently moves the wrappers' internal React context to a
  different module instance than the one `ChatPage.tsx` imports
  directly - one React tree, two `AssistantRuntimeProvider` instances,
  invisible to `tsc`, only visible once Home's full frontend suite ran
  (18 failures, "requires an AuiProvider"). A separate attempt also
  rippled `zod` into Home's backend (13 more, unrelated failures).
- Conclusion already reached: no version serves both consumers without
  a real, coordinated upgrade - the kit's wrappers, Home's own import,
  and Home's full test suite bumped and re-verified together, in one
  kit tag and one Home commit, per COORDINATOR's own framing of this
  item.

**The work**: find the `@assistant-ui/react` version (and its
`@assistant-ui/react-markdown` pair) that ships `modality` on
`message.metadata`, bump both the kit's `ui/src/assistant-ui/`
wrappers and Home's `ChatPage.tsx` import together in that one
version, run Home's full frontend suite (`bun test` in `frontend/`,
502 tests as of this hand-off - the 18-failure signature from the
earlier attempts is exactly what a real desync still looks like), fix
whatever the new major/minor actually breaks in the wrappers
themselves (not just the version string), then wire `/next/chat` on
the Elements' `Thread` with a mock `useLocalRuntime` + canned
`ChatModelAdapter` (assistant-ui's own docs-site pattern - not a
registry item, Home writes this glue itself) per the stand-up's
original ask. The old chat (flag off) must keep working throughout;
`ChatPage.tsx`'s own hand-built path is only deleted at the eventual
switch, not as part of this item.

**Acceptance**: one kit tag (`ui-v0.5.7` or later), one Home commit;
full `home` suite green with the flag both on and off; `/next/chat`
screenshot (1440 and 390, both themes) opened and judged the same way
this hand-off's own captures were, showing a real empty-state thread
against the mock runtime, nothing Home-drawn.
