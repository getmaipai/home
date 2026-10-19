# Frontend color audit, 2026-10-19

Scope: `frontend/src` excluding dependencies and tests, plus shipped catalog media page definitions in `backend/packages/{music,podcasts,videos}/pages`. `docs/design/assets` has no runtime imports or references from the frontend, so it does not ship in the app and was not included. Token definitions in `frontend/src/shell/tokens.css` and `frontend/node_modules/@maipai/ui/src/tokens.css` are the theme source and are intentionally exempt from call-site findings.

The lint fixture `frontend/src/dev/colorLints.test.ts` verifies fixed CSS color syntax, CSS named colors, Tailwind palette classes and arbitrary hex classes. The production lint scans frontend source and excludes test files and the two Home token definition files. These are all of the concrete app source findings from this audit; comment mentions and issue-number fragments are not style values.

## Fixed values found and disposition

| File:line | Finding | Verdict |
| --- | --- | --- |
| `frontend/src/main.tsx:30` | Inline startup error background `#0b0b0f` | Replaced with `var(--background)` |
| `frontend/src/main.tsx:30` | Inline startup error foreground `#f5f5f7` | Replaced with `var(--foreground)` |
| `frontend/src/main.tsx:33` | Inline startup error supporting text `#a1a1aa` | Replaced with `var(--muted-foreground)` |
| `frontend/src/shell/useAppearance.ts:6-7` | Fixed light and dark browser theme-color values | Replaced with computed `--background` |
| `frontend/src/shell/pages/settings/settingsTokens.css:18` | Neutral switch `#3983f7` | Removed override; kit default `--primary` follows selected look |
| `frontend/src/shell/tokens.css:135` | Named `white` on Incognito active navigation | Replaced with the existing `--hue-violet-foreground` theme token |
| `frontend/src/shell/pages/status/statusBanner.css:4,8,25,30` | Named black/white in status color mixes | Replaced with existing `--status-ok` and `--status-error` tokens |
| `frontend/src/apps/people/FaceEnrollmentPage.tsx:704` | `bg-black` camera preview backing | Allowed: live camera preview needs a black base during camera initialization; documented in `frontend/src/dev/color-lint-allowlist.json` |
| `frontend/src/apps/people/FaceEnrollmentPage.tsx:716` | `bg-black/60` camera scrim | Allowed: maintains guidance legibility over arbitrary live camera frames; documented in `frontend/src/dev/color-lint-allowlist.json` |

No other production CSS color literals, named color declarations, Tailwind palette classes, arbitrary color utilities or inline color declarations were found in `frontend/src`. The packaged Music, Podcasts and Videos page JSON files contain no color literals, named colors or palette classes. Their surfaces and song card presentation come from the shipped package renderer and kit tokens; Home adds no navy or fixed-color styling to those pages/cards.

## Kit requests

None identified in the audited production call sites. Existing `--background`, `--foreground`, `--muted-foreground`, `--primary`, `--hue-violet-foreground`, `--status-ok` and `--status-error` tokens cover the required uses. No commons files were changed.
