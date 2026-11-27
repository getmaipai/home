# Red tests on main, 2026-11-27

## backend/tests/ageComparisons.test.ts

- Failing assertion: the shrink-only allowlist must exactly match source; eight new age comparisons were reported.
- Breaking commits and rows: `e26adb853` `PRIVACY-LEVEL-PROOF-01` (tool audit unknown band retains the trail); `d47a38435` shadow-only specifics check; `57366b2c8` `ACT-POLICY-ALLOWLIST-01`; `edd761391` `CODE-GIT-01/02`; `0d8e01f3e` `STACK-MODELS-HOME-01`; `e9b5aee0b` Incognito; `146dc9439` chat projects. The exact line in `aiTiers.ts` was moved by `0d8e01f3e`; the person-role behavior dates to the age routing work, `c0aa09961` `AGE-ROUTING-REMOVE-01`.
- Disposition: INTENDED comparisons at each site implement explicit safety, privacy, audience or access gates. The allowlist test is behaving as designed. AUDIENCE-01 owns any source refactor; do not add these lines to the allowlist until the owner audits each site.
- REPORT ONLY: audience/access maintainers should route any eligible comparison through the approved helper, then update only the matching shrink-only entries after proving unchanged behavior.

## backend/tests/composerModes.test.ts

- Failing assertion: adult picture mode chips contain only `shape` and `count`; source also returns `set`.
- Breaking commit and row: `c0aa09961`, `AGE-ROUTING-REMOVE-01` changed the age and pass routing; the failing chip is part of the active Create composer work, row `VF-IA-01`.
- Disposition: REGRESSION in an active feature area.
- REPORT ONLY: composer owner should reconcile the picture page's `set` slot with the package composer mode contract and parity tests.

## backend/tests/perfWatch.test.ts

- Failing assertion: none. All four tests passed in the individual-file run.
- Breaking commit and row: no breaking commit identified; this is a green watcher entry.
- Disposition: INTENDED, no failure observed.
- FIXED: no change needed.

## backend/tests/podcastParity.test.ts

- Failing assertion: Latest row badge is expected to be `New`, actual is empty; Mark unplayed also leaves the badge empty; directory search returns a row with an empty feed URL.
- Breaking commit and row: `0cb3e02d2` finish-round podcast changes added the unplayed dot and Mark all played; `5beacf493` App parity round 1 added latest rows and badges; podcast parity is within the open Podcasts package work at `docs/BACKLOG.md` 1125.
- Disposition: REGRESSION in active podcast package work.
- REPORT ONLY: podcast package owner should restore the New/Played badge projection and ensure show search results carry their feed URL.

## backend/tests/transcriptsRoutes.test.ts

- Failing assertion: children expected 403 for transcript read and detect-speakers requests; both return 404.
- Breaking commit and row: `6517b6786` `CAPTION-01g` added Detect speakers; `13d9ac1ef` `CAPTION-01c` introduced transcript routes. `ec3bb2074` `UNSEEN-01` is the nearby intended absent-resource policy that the child 404 result now appears to apply.
- Disposition: REGRESSION requiring an explicit decision on how the transcript child refusal contract interacts with unseen-resource semantics.
- REPORT ONLY: transcript owner and safety reviewer should reconcile the tests and route behavior while preserving stranger 404 and child protections.

## backend/tests/safety.test.ts

- Failing assertion: crisis overlay test cannot write `engines.pictures.order = "-stressed"` (expected successful settings write, received false).
- Breaking commit and row: `3b8c57f19` triage commit updated the stress helper and noted tier-slot values; `2bfba51e6` `STACK-MENU-SYNC-01` moved engine controls to Stack. The request to write this Stack-owned key through Home has no applicable backlog row and needs clarification.
- Disposition: REGRESSION, safety-critical and needs source-owner review.
- REPORT ONLY: settings/Stack owner should identify why this registry key rejects its own valid stress value, fix validation without making crisis handling configurable, and rerun the full test individually.

## backend/tests/seed.test.ts

- Failing assertion: no route assertion was reached; screenshot backend exited before reporting its bound port.
- Breaking commit and row: `40c966afd` shared demo seeder, `MUSIC-DEMO-01`; the advertised Porchlight FM 404 was not reproduced because startup failed first.
- Disposition: INTENDED test setup could not run in this environment; seed behavior remains unverified.
- REPORT ONLY: rerun with the screenshot backend's required port access, then inspect the station save 404 if it reproduces. Seed owner for `MUSIC-DEMO-01`.

## backend/tests/settingsCopy.test.ts

- Failing assertion: the metadata agreement test expected a child's `access.thinking` self-write to match `control`; the settings boundary correctly refuses self-service access overrides.
- Breaking commit and row: `c0aa09961` `AGE-ROUTING-REMOVE-01` made thinking an admin-overridable access item; its band defaults are child/teen false, adult true. The metadata expectation was last refactored with settings copy in `5e1f4195c`.
- Disposition: INTENDED source authorization; stale test expectations.
- FIXED: `backend/tests/settingsCopy.test.ts` now checks that access and content overrides are admin-only and uses their declared band defaults. The test passes.

## backend/tests/mediaSourcesView.test.ts

- Failing assertion: child collection add expected 200 and received 404; a source count expected 0 readable items and received 2.
- Breaking commit and row: `7cbd86ed8` `AUDIT-ROUTES-01` changed media write route behavior; `96d25e536` `MEDIA-KID-01` established filtered source counts.
- Disposition: REGRESSION in media routes and source views.
- REPORT ONLY: media owner should repair collection add authorization/response semantics and calculate per-source counts using the same `readableItem` filter as item lists.

## scripts/jobs/job.test.ts

- Failing assertion: timed job capture omitted `sleep 60`; a detached worker remained alive; orphan cleanup did not log its stop; remaining failures include process inspection calls refused with EPERM.
- Breaking commit and row: `ad49d16fb` `DEV-BUDGET-02` changed process-tree accounting; the history spans delivery pipeline supervision. No single break commit identified.
- Disposition: REGRESSION mixed with sandbox process-inspection limits.
- REPORT ONLY: delivery tooling owner should reproduce outside the restricted process environment, then repair process-tree capture and descendant cleanup if the failures persist.

## frontend/src/shell/pages/AdminPages.es.test.tsx

- Failing assertion: rendering Performance crashes because `WaterfallBody` reads `data.recent.map` when `recent` is undefined.
- Breaking commit and row: `7f21628ed` added the Waterfall card strings under `TURN-WATERFALL-01`; `c3878ab00` moved shell paths. The immediate issue is a test fixture shape mismatch with WaterfallBody's current data contract.
- Disposition: REGRESSION in admin Performance test setup/component contract.
- REPORT ONLY: the Performance page owner should align the fixture with the waterfall response (`recent` array) and keep the render guarded for incomplete responses if they are supported.

## frontend/src/shell/localeShell.test.tsx

- Failing assertion: Spanish catalog lookup for `Nothing pending.` returns the English id unchanged.
- Breaking commit and row: `350f0578f` Activity merge removed the bell-specific Spanish test; Activity now owns notifications, so this test's expected string is stale. The active Activity page is covered by its page tests.
- Disposition: INTENDED removal of the old bell flow; stale assertion.
- REPORT ONLY: update the test to assert a currently rendered Activity message, or remove this obsolete expectation through the shell owner. No `Nothing pending.` source string exists to translate.

## Still failing or unverified

- Age-comparison guard: new unapproved comparison sites remain for AUDIENCE-01 review.
- Composer mode picture chip parity.
- Podcast Latest badges and show search feed URL.
- Transcript child refusal status contract.
- Crisis test settings write failure.
- Seed test backend startup and Porchlight FM behavior.
- Media collection edit and per-source counts.
- Job process-tree and cleanup tests; process visibility is restricted here.
- Admin Spanish test was not separately run.
- Spanish locale test still expects obsolete `Nothing pending.` copy.
- `perfWatch.test.ts` passed.
