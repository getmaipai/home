# The language stack: catalogs, scripts, lint and server copy

Dev tier. How Home shows a person's language: where the strings live, the scripts that make and check the catalogs, the lint that stops
new hardcoded text, and how server wording (notifications, failure lines, API errors) reaches the screen. Design record:
[docs/design/i18n-2026-11-07.md](../design/i18n-2026-11-07.md) (owner decisions, section 1). Slices: I18N-F0 to F6 (frontend), B1 and B2
(backend), K1 and K2 (commons). User page: [docs/user/language.md](../user/language.md).

## What a person gets

- Languages: `en-US`, `en-GB` and `es` (neutral international Spanish, informal "tu"). The list is declared once, in
  `backend/src/lib/supportedLocales.ts`; `frontend/src/supportedLocales.ts` and `frontend/lingui.config.ts` read it, with the fallback chains.
- `person.locale` (spec key, `lives_in: person.profile`): `household`, `en-US`, `en-GB` or `es`, default `household`. It is drawn by the
  kit settings renderer on the Profile and sign-in page (the Language card, `AccountProfile` in `shell/pages/settings/settingsViews.tsx`).
- `household.locale` (`en-US`, `en-GB`, `es`): the default for people who never chose, and the language of the sign-in page.
- `resolveLocale(person)` in `backend/src/lib/locale.ts` is the one resolver: the person's value if real, else the household value, else
  `en-US`. A test greps that no other code reads either key.
- Signed out, the page reads `GET /api/auth/locale` (`{ locale }`, the household value, nothing else). The picker never shows or switches to
  a person's own language.
- A change applies without a reload: `usePersonLocale` (`frontend/src/shell/usePersonLocale.ts`) re-activates when either setting changes.
  Activations are queued and only the newest runs, so a slow catalog chunk for an older choice cannot land after a newer one.

## Catalogs

| File | Holds |
|---|---|
| `frontend/src/locales/en-US/messages.po` | Source locale. Message id equals the English text (or an explicit id such as `setting.person.locale.label`). About 5,100 messages. |
| `frontend/src/locales/en-GB/messages.po` | Only entries whose spelling or wording differs. An empty `msgstr` falls through to `en-US`. |
| `frontend/src/locales/es/messages.po` | Spanish. Filled by the translation script, flagged `#, needs-review`. |
| `frontend/src/locales/glossary.json` | Dialect, style rules and fixed terms (brand and product names stay as they are). |

Rules:

- Write strings with the runtime API, never macros (Vite has no Babel): `i18n._({ id: "Saved {name}", message: "Saved {name}", values: { name } })`.
  Never `<Trans>` in app code: it throws in a bare test render. One message per sentence, a placeholder for every dynamic part, ICU
  `{count, plural, one {# item} other {# items}}` for counts. Module-level text constants are functions evaluated at render time.
- `en-US` loads eagerly. `en-GB` and `es` are one dynamic import each (`catalogLoaders` in `frontend/src/i18n.ts`); each compiled file already holds
  its fallback chain, so an untranslated id arrives as English, never as an id. A failed load keeps the current language and logs once.
- Child and teen modes use `<locale>-x-child` and `<locale>-x-teen` locales (KID-MODE-04). Their files hold only the override ids.

## Scripts (run from `frontend/`)

| Command | What it does |
|---|---|
| `bun run i18n:extract` | `lingui extract --clean`: adds new ids to every `.po`, drops ids no source uses. The catalog also reads `backend/src/lib/failureCopy.ts`, `apiErrorCopy.ts` and `notificationCopy.ts` (descriptors marked `/*i18n*/`). |
| `bun run i18n:check` | Catalogs are current, every locale has a catalog with a `Language` header, placeholders match the source, no U+2014, the generated setting copy is current, and no `needs-review` flag sits on protected copy. |
| `bun run i18n:settings` | `scripts/extract-setting-copy.ts` writes `src/lib/settingCopy.generated.ts` from the live settings registry (spec plus Home keys), areas and reason vocabulary. Never hand-edit it. A new key is a failing `i18n:check` until this runs. |
| `bun run i18n:codemod -- <file.tsx...>` | Rewrites JSX text, text props, `toast.*` and `setError` strings into `i18n._`. Text around simple expressions becomes one message with named placeholders. |
| `bun scripts/translate-catalog.ts --locale es` | Fills empty `msgstr` entries (details below). |

### The translation script

`frontend/scripts/translate-catalog.ts`, `--locale es` or `--locale en-GB`, with `--file <text>`, `--max-batches N`, `--dry-run`, `--redo`,
`--review` and `--accept <file|id>`.

- One batch per source file (split above 150 entries). It asks the Stack chat role (`MAIPAI_STACK_URL`, default `http://127.0.0.1:8770`),
  one batch at a time, and stops on the first "not ready". The only host it talks to is the Stack; nothing leaves the home.
- Each answer is validated: same placeholders and ICU shape, no U+2014, no exclamation point the source lacks, length within 3 times the
  source. A failing entry is retried once alone, then left empty (it shows in English) and listed.
- Every entry it fills gets `#, needs-review`. A filled entry without the flag is reviewed and final; a re-run never overwrites it.
- Protected copy is never filled: any entry whose source file or id matches `child|teen|minor|crisis|consent|refusal|spoken|robot|SEARCH-DOWN-EMPTY-01`
  (`isProtected`). `i18n:check` fails if such an entry carries `needs-review`, so it must be written and reviewed by a person.
- `--review` writes `data-scratch/i18n-review/<locale>.md` (git-ignored): each flagged entry with its back translation. `--accept <file|id>`
  clears the flag after a person has looked.
- To correct a wrong line: edit its `msgstr` in `frontend/src/locales/es/messages.po`, run `--accept` for that id, then
  `bun run i18n:check`. A user reports a line to the person who runs the home; the fix is a commit.

## The lint

`bun run lint:i18n` runs `src/dev/i18nLints.test.ts`, `i18nLintRun.test.ts` and the script tests (translate, flag, codemod, setting copy).

- Hardcoded text: JSX text and the string props `title`, `label`, `placeholder`, `aria-label`, `alt`, `description`, `hint`, `tooltip`,
  `caption`, `subtitle`, `heading`, `message` and `text`, outside `i18n._`. `src/dev/i18n-allowlist.json` lists exceptions, each with a reason.
- Formatting: `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` and `Intl.*` calls are allowed only in `frontend/src/lib/format.ts`
  (`formatDate`, `formatTime`, `formatNumber`, `formatList`, relative times and units). They read `activeLocale()` at call time.
- Baselines (`i18n-baseline.json`, `i18n-format-baseline.json`) only shrink. Both are empty after F6, so the lint is absolute.

## The kit

The kit (`@maipai/ui`, commons) has its own catalogs: `ui/locales/{en-US,en-GB,es}/messages.po`, ids prefixed `ui.`, compiled to `messages.ts`.
`ui-v0.5.518` (I18N-K1) exports `loadKitCatalog(locale)` (call it before `i18n.activate`), `kitLocaleTag()` and the chains in `src/kitLocales.ts`.
The kit reads Lingui's global `i18n` (peer dependency `@lingui/core`) and shows English from a private instance when Home loaded nothing.
Its Spanish is machine-written and flagged `needs-review`; 13 protected entries stay English.

Status on 2026-11-07 (I18N-K1b): Home pins `ui-v0.5.518` and `activateLocale` calls `loadKitCatalog` after Home's own entries, so the kit's text (the rail, the search box,
the profile menu, "Restablecer a los valores predeterminados", the composer) shows in Spanish. Spec `0.1.338` (I18N-K2) is pinned:
`describeSetting` takes a translator, and Home passes the generated setting copy through `installSettingCopyCache`.

## Server wording

| What | Where | How it reaches a person |
|---|---|---|
| Failure lines (chat, voice, engines) | `backend/src/lib/failureCopy.ts` | Descriptors `{ id, message }`; the client calls `i18n._`. `adult` and `minor` stay separate ids and minor lines are never machine-filled. |
| Notifications | `backend/src/lib/notificationCopy.ts` (English), `notificationCopyEs.ts` (hand-written Spanish) | A row stores `{ typeId, values }`. The bell renders the id in the viewer's language. A type with no template (pass-through titles, safety, child and teen lines) shows its stored English text. Rows made before B1 keep their finished text. |
| Telegram and spoken lines | `backend/src/lib/i18nServer.ts` | `renderNotificationFor(recipient, typeId, values)` uses the recipient's locale, and always English for a child or teen. `spokenNotificationLine` gives a Spanish adult the hand-written spoken line, run through the speech normalizer (`spokenTextEs.ts` is its Spanish path). Null means "send the stored English". |
| API errors a screen prints | `backend/src/lib/apiErrorCopy.ts` (`API_ERROR_LINES`, 34 codes), `apiError("code", extra)` | The body carries `{ error, code, next? }`. The client maps the code to a catalog message (`frontend/src/lib/apiErrorLines.ts`, `errorLine()`), and only when the server's English equals the table's English for that code. Unknown codes show the server English. Full table: [api-error-audit.md](api-error-audit.md). |
| Setting labels, help and reasons | `settingCopy.generated.ts`, spec `describeSetting` | Ids `setting.<key>.label`, `.help`, `.option.<value>`, `.reason.<state>`. |

Model prompts and system text stay English. Home tells the AI no language; it answers in the language the person writes (rule 1).
The child floor (`@maipai/spec` safety classifier) is English only, so no child, teen, robot or shared-surface turn carries a language line.

## Tests worth knowing

`frontend/src/i18n.test.tsx`, `i18n.chain.test.tsx`, `shell/usePersonLocale.test.tsx`, `shell/localeShell.test.tsx`, `signedOutLocale.test.tsx`,
`supportedLocales.test.ts`, `backend/tests/locale.test.ts`, `apiErrorCodes.test.ts`, `notificationTypes.test.ts`, and the lint tests above.
