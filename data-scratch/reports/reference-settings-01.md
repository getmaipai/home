# REFERENCE-SETTINGS-01 report

Built the admin-only Reference library section in Home settings using the existing `SettingsShell` and shipped kit parts. It lists catalogue sets with language, resolved size, snapshot date and installed state; shows current preset matching; plans presets and single installs before confirmation; confirms removal with bytes freed and affected age bands; and polls job state while active to show progress and pause, resume and cancel. Custom is an in-memory selection list and is not saved as a preset. Mutations use the existing per-set install/remove and job routes.

Added `GET /api/reference/catalog`, admin-only, because `/api/reference/state` does not expose the full set catalogue or size and age-band metadata. It resolves publisher metadata through the engine's existing Kiwix resolver and returns a per-set availability message if Kiwix no longer offers a flavour. No settings keys, package pins, setup wizard files or voice enrollment files were changed.

The screenshot script captured seeded demo household images at 1440 and 390 in light and dark. I opened all four: desktop copy is readable with visible contrast in both themes; the phone has no horizontal overflow and its copy wraps without truncation. The phone's first view shows the preset list and the beginning of the set list; actions remain reachable by scrolling.

Checks run:

- `cd frontend && bun run lint:ui-rules`
- `cd frontend && bunx tsc --noEmit`
- `cd frontend && bun test src/apps/settings/ReferenceLibrarySettings.test.tsx src/shell/pages/settings/SettingsAreaPage.test.tsx`
- `cd frontend && bun run lint` (passed; two existing hook dependency warnings in ChatPage and useShellAppearance)
- `bun run scripts/screenshot.ts --reference-settings-review`
- `cd backend && bunx tsc --noEmit`

`bash scripts/wt.sh check` passed its generated-file checks, UI rules and typechecks, but its full backend test process stalled while Deno test workers waited on IPC with the test parent. I stopped that stuck process tree to release the shared check lock. The focused frontend tests and frontend/backend typechecks passed. Live Kiwix catalogue behavior was not verified; the screenshot uses a stable routed catalogue fixture against the seeded demo backend.
