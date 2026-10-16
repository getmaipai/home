# REFERENCE-SETTINGS-01b report

Fixed the review findings on the Reference library settings page. The settings area now comes directly from the pinned spec v0.1.145, while the `home.reference_library` view registration remains in Home. Updated settings tests to the spec's Reference library section order and verified the admin view remains reachable while child access is blocked.

Removed the in-memory Custom selection checkboxes, selection state and Custom list card. The per-set Install and Remove actions remain the custom path. Kept Minimum, Moderate and Full shortcuts, with the current shortcut marked. Removed the component's duplicate Reference library heading and retained its one-line description. Preset confirmation now uses the label from `reference-presets.json` (for example, “Install the Minimum library?”) and says that existing sets stay installed. Applying a preset continues to install only missing sets and never removes sets.

Regenerated and opened all four review captures at 1440 and 390 px in light and dark themes. No horizontal overflow, clipped or truncated copy, or contrast issue was visible. The Quick choices and All sets labels sit close to their kit cards; this is recorded for review and no kit spacing override was added.

Checks:

- `cd frontend && bunx tsc --noEmit && bunx eslint . && bun run lint:ui-rules` ; passed (ESLint reports the two existing hook dependency warnings in ChatPage and useShellAppearance).
- `cd frontend && bun test src/apps/settings/ReferenceLibrarySettings.test.tsx src/shell/pages/settings/settingsMatrix.test.ts src/shell/pages/settings/SettingsAreaPage.test.tsx` ; 56 passed.
- `bun run scripts/screenshot.ts --reference-settings-review` ; passed; all four captures reviewed.
- `bash scripts/wt.sh check` ; preflight passed and the full gate acquired the machine lock after 150 seconds. The backend API-doc drift check failed: `docs/api/openapi.json` is out of date with route registrations and the generator requested `bun run gen:api-docs` in backend. I excluded that unrelated generated diff. The frontend gate leg passed UI rules, typecheck, ESLint (two existing hook dependency warnings), build and a11y. The scripts test shard passed 191/191; backend tests did not report any spec test failure names before the gate stopped. The gate also logged its frontend worker terminated with signal 15 during shutdown. No spec test failures were reported, so there was no origin/main spec-test comparison to make.
