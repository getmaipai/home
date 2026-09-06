# Session E: the UI, the wizard, and the user docs

Work order: `docs/plans/session-e-ui-and-docs.md`, under
`docs/plans/wave-2.md`. Worktree `../home-e`, branch
`session-e-ui-and-docs`, `MAIPAI_DATA_DIR=data-e PORT=8803`.

## Step 0: setup and B's leftovers

**Wave 1 had not merged when this session started.** `wave-2.md` assumes
E starts once B has merged; neither Session A nor B had, and both
worktrees (`../home-a`, `../home-b`) still existed with clean trees.
Merged both into `main` directly (Jesse's explicit direction, since D and
F were also blocked on this): `session-a-intelligence` at commit
`dd4f8cf`, `session-b-ui` at `4a9e989`. Both merges' own conflicts were
in the shared-file categories `wave-2.md` names (migrations,
`schema-version.ts`, `notificationTypes.ts`, fixture tests) and resolved
per its protocol (regenerate, keep both sides).

**A real gap found only after merging, the hard way:** both merge commits
were made believing `check.sh` had passed - it hadn't. The verification
command was `bash scripts/check.sh > log 2>&1; echo "exit: $?"`, and the
echo's exit code (always 0, since it's the last command in the chain,
not check.sh's own) was misread as check.sh's result. Actual failures,
found by grepping the logs for check.sh's own `all checks passed` line
after the fact: the merge's conflict resolution deleted
session-a-intelligence's now-superseded migration files on disk but never
staged the deletion (independently caught by Session D while rebasing);
Session A's step 10 made `Person.hlc` required and nine frontend test
fixtures (this session's own ownership) never gained it; Session A's
`turn_meta` stream event broke `chatModelAdapter.ts`'s and
`runFixedTurn.ts`'s unhandled-event-type handling, so every chat turn and
every home-card fixed-turn call threw immediately. All fixed in commit
`2956e1f`, verified this time by grepping for the literal success line,
not an exit code from a chain. Also fixed upstream: `getmaipai/.github`'s
`prose-lint.sh` flagged `!==`/a non-null assertion inside inline code
spans as a banned exclamation point (`340fb4e`); Session D separately
found and fixed a second false-positive class in the same script (HTML
comments, `14d92d7`).

**Shipped, this session's own step 0:**

- The PWA (`vite-plugin-pwa`, `generateSW` strategy): `frontend/src/lib/
  pwaBoot.ts` (7 tests) covers the three boot-resilience guards docs/
  UI.md's PWA section asks for - a stale chunk after a deploy (Vite's own
  `vite:preloadError` event), a new service worker taking control
  mid-session (`controllerchange`, reload once, never twice), and the
  shell itself failing to boot (a watchdog capped at three retries before
  giving up rather than reloading forever). `public/offline.html` (plain,
  says nothing here works without the hub yet - nothing is genuinely
  offline-capable at this stage). The onnxruntime-web WASM runtime
  (~40 MB, `copy-ort.mjs`) is excluded from the precache manifest
  (`globIgnores`): it is a lazily-loaded model dependency, not the shell,
  and precaching it would itself violate "caches only shell and kit," in
  the direction of doing too much. `manifest.webmanifest` gained real
  192/512 px icons (generated from the existing 1254 px brand asset via
  `sips`, not hand-drawn) alongside it.
- The screenshot/accessibility matrix (`scripts/screenshot.ts`, extending
  the existing hero-shot script rather than a second one): every route
  App.tsx declares, at phone/tablet/desktop/far (far = a TV user agent,
  matching `useSurface.ts`'s own detection, not a viewport width) and
  light/dark, against `@axe-core/playwright`, plus a horizontal-overflow
  check. `bun run screenshots` is the full matrix (saves PNGs under
  `docs/assets/screens/`, for a human to look at before a final commit);
  `bun run a11y` is a fast two-combo subset (phone/dark, desktop/light,
  no images) meant for `scripts/check.sh` - not wired in there since that
  file is Session F's per `wave-2.md`'s shared-file protocol, noted here
  and in `docs/BACKLOG.md` for F to add.
- The 16 px type-floor sweep: the notification bell's unread badge and
  the chat thread's day-divider/message timestamps were `text-xs`
  (12 px), under docs/UI.md's stated floor. Bumped to `text-base`
  (16 px); the bell badge grew from `h-4`/`min-w-4` to `h-5`/`min-w-5` so
  the larger text still fits without clipping.
- `Chip` (`frontend/src/kit/primitives/Chip.tsx`, 5 tests): the Material
  3 chip docs/UI.md names as the pattern for what shadcn/ui doesn't ship.
  Both filter (togglable, `aria-pressed`, a check when selected) and
  input (dismissible, an X) variants; the remove control's touch target
  is expanded via an invisible absolutely-positioned hit area rather than
  growing the chip's own height to the kit's 48 px floor, which would
  blow out row height everywhere a chip sits inline with text. No caller
  yet - built ahead of need per this step's own list, the same posture
  `Textarea`/`Tabs` (already present as shadcn primitives, nothing to add)
  were flagged under.
- `usePinAutoSubmit` (`frontend/src/kit/hooks/usePinAutoSubmit.ts`, 6
  tests): the PIN auto-submit-on-4-digits behavior `SignIn.tsx` and
  `ProfileSwitcher.tsx` had each hand-rolled, the second copy's own
  comment naming this exact extraction as a "real follow-up... not done
  here." Both call sites now share it; behavior unchanged (both files'
  own existing tests still pass unmodified).

**Left for a later step, named:** `Textarea` and `Tabs` already exist as
generated shadcn primitives (`kit/ui/textarea.tsx`, `kit/ui/tabs.tsx`);
neither has a URL-bound-tab wrapper yet, since nothing in the app uses
tabs today - built when a real page needs one, not speculatively.

**Real bugs the matrix script found in the very code it was built to
check, several rounds of them:**

- `bun run a11y`'s first real run threw `AxeBuilder#analyze()`:
  "Execution context was destroyed, most likely because of a
  navigation" on the Home route, non-deterministically. Root-caused
  with an isolated standalone repro (a bare script, no matrix):
  `main.tsx`'s new `installReloadOnceOnNewServiceWorker` reloaded the
  page the moment the shell's service worker first claimed it -
  correct for a real update mid-session, but a brand-new browser
  context's very first page visit triggers that exact same event with
  no prior version to distinguish it from. A medium-effort code review
  on the diff caught this precisely and named the right fix: only wire
  up the reload when `container.controller` was already non-null
  before this call (`pwaBoot.ts`), so a page's first-ever load - which
  already has the right content straight from the network - is never
  reloaded. Once fixed at the source, the matrix script's own
  `primeServiceWorker()` workaround (visit `/`, wait for the worker,
  reload deliberately) became dead weight and was deleted rather than
  kept alongside the real fix.
- The same review found `runBootWatchdog`'s stale-chunk cap and boot
  cap were two independent `MAX_BOOT_RETRIES` budgets, so one
  permanently broken deploy could cost six reload cycles total,
  contradicting the file's own "capped at three attempts" comment;
  unified to one shared `RETRY_KEY`. Also found the watchdog's catch
  block swallowed a synchronous boot exception with no trace at all -
  added `console.error` before the reload-and-retry.
- `usePinAutoSubmit`'s guard (a plain boolean, "has this ever fired")
  meant a second, different 4-digit PIN never auto-submitted after one
  wrong attempt - not a regression (the original pre-extraction code
  had the identical limitation), but a real papercut once named.
  Switched to tracking the exact string already tried, which still
  blocks the original success-path infinite loop (the value doesn't
  change) while letting a genuinely different PIN retry.
- `vite.config.ts`'s `globIgnores` excluded the onnxruntime WASM
  binaries but missed the runtime's own JS loader
  (`assets/ort.bundle.min-*.js`, ~400 KB), which the precache manifest
  confirmed was still being eagerly cached - added the missing glob.
- Running the fixed matrix again (not just re-trusting the review)
  surfaced two more real, previously-undetected violations on Home:
  `region` (content outside every landmark) traced to the stock
  shadcn/ui `CommandDialog` (`kit/ui/command.tsx`) rendering its
  `DialogHeader` as a sibling of `DialogContent` rather than inside it
  - Radix's `Dialog.Root` has no DOM output of its own, so anything
    that isn't `DialogContent` (or portal-wrapped) renders in place,
    unconditionally, regardless of `open`. Moved the header inside the
    content, matching what Radix's own `aria-labelledby` wiring expects
    anyway. A first attempt at the landmark fix (wrapping `Shell.tsx`'s
    content column in a second `<main>`) was wrong and reverted:
    `SidebarInset` already renders as `<main>`, so that just traded one
    violation for three duplicate-landmark ones - the sidebar's own nav
    links (a plain `div` in shadcn's `Sidebar`, no landmark role) turned
    out to be the real desktop-only gap, fixed with `role="navigation"`
    at the `Shell.tsx` call site rather than hand-patching the
    generated component.
- One real, remaining violation, deliberately not patched here:
  `color-contrast` on `--primary` (white text at 2.8:1 against
  `#06a9c6`, WCAG AA wants 4.5:1) - a token-level design decision
  (`docs/BACKLOG.md` has the exact numbers), correctly step 7's job
  ("colour contrast ratios against the real token palette in both
  themes"), not a one-line hack to make this step's own tooling pass.

**Verification status:** `scripts/check.sh` - the actual required gate
- passed clean and fast (`all checks passed`, confirmed by grepping for
that literal line, not an exit code, after the earlier merge-commit
mistake this step's own history records above). `bun run a11y` is not
part of that gate yet (F's to wire in), so it did not block this
commit, but it was run to green anyway: `0 violations, 0 overflow`
across all 22 phone/tablet/desktop/far x light/dark x 11-route
combinations in the full matrix, and the fast two-combo subset, both
after every fix above. Getting there took several live runs against a
dev machine under severe, sustained multi-session contention (load
average climbed from ~6 to ~9.4 over the course of this step, several
concurrent `check.sh`/build/browser workloads from Sessions D and F) -
some early attempts stalled on resource-starved child processes
(confirmed via `ps`: near-zero CPU time accruing over minutes of wall
time, not a hot loop) rather than any real error, and were retried
rather than trusted as either pass or fail. `bun run screenshots`
(the full matrix, with images) has not been run this session; re-run
it and look at the resulting PNGs before they are used anywhere, per
the org's own screenshot rule, before they are relied on for anything
beyond this step's own verification.

Separately, fixed upstream in `getmaipai/.github` while investigating
`check.sh`'s own slowness: `prose-lint.sh`'s bash implementation
(compounding this step's inline-code fix with Session D's HTML-comment
fix) took over a minute against `docs/dev.md`'s own thousands of
lines - rewritten as `prose-lint.awk` (the identical state machine,
C-native string ops), under a tenth of a second, `prose-lint.test.sh`'s
full assertion set unchanged (`7a0751f`).

Full backend + frontend + spec suites green (705 backend, 339
frontend), `bunx tsc --noEmit` clean in both `backend/` and
`frontend/`, `bun run lint` clean (two pre-existing warnings, neither
touched by this step), `scripts/check.sh` green end to end.
