# API error audit (I18N-B2)

Design note: `docs/design/i18n-2026-11-07.md`, section 9 step 3. The server keeps sending English `error` (and `next`) text. A route whose
text a screen prints also sends a stable `code`; the web client maps the code to a catalog message id and shows the person's language.
Anything the table does not know shows the server's English, so an old backend still renders.

## Where the wording lives

| What | Where |
|---|---|
| The one table (code, message id, English) | `backend/src/lib/apiErrorCopy.ts` (`API_ERROR_LINES`) |
| Building a response | `apiError("code", { ...extra })` returns `{ error, code, next? }` plus the route's own extra fields (`retryAfter`, `attemptsLeft`, `lastSeenAt`) |
| Client table (code to translated text) | `frontend/src/lib/apiErrorLines.ts` (`localizedApiMessage`, `localizedApiNext`), reads the same table |
| Where it is applied | `errorLine()` in `frontend/src/lib/hubReachability.ts` (about 107 call sites, `useHubMutation` included), `usePasscodeAttempt`, `InstallDock`, `InstallStrip`, `MediaPickerDialog` |
| "Could not ${verb}." | `frontend/src/lib/hubMutationVerbs.ts`, one catalog sentence per verb (15) |
| Minor-facing lines | their own `minor` flag and an id containing `minor`; the translate script never fills them |

Rule for the client: translate only when the code is in the table AND the server's English equals the table's English for that code. A
generic code that another route reuses with different text (`invalid_input`, `unavailable`) therefore never mislabels a message.

Tests: `backend/tests/apiErrorCodes.test.ts` (every code is sent by a route, every route use names a table code, real routes answer with
code and the same English), `frontend/src/lib/apiErrorLines.test.tsx` (catalog ids exist, fallbacks, Spanish through the real client for
three routes, Spanish toast), `frontend/src/lib/hubMutationVerbs.test.ts` (every `verb:` passed to `useHubMutation` has a sentence).

## Coded routes (user-facing)

Screen column: where the text reaches a person. "any form" means the shared `errorLine` path (toast or inline error line).

| Code | English | Route (file:line) | Screen that prints it |
|---|---|---|---|
| profile_not_found | Profile not found | auth.ts:190, 243 | Sign-in profile picker and PIN screen (usePasscodeAttempt) |
| profile_needs_secret | This profile needs its PIN, password, or passkey | auth.ts:206 | Sign-in profile picker |
| no_secret_set | No PIN or password set for this profile | auth.ts:253 | PIN check on a profile with no secret (usePasscodeAttempt) |
| attempts_locked | Too many attempts | auth.ts:234, 348; totp.ts:62, 64, 68, 157, 159; passkeys.ts:186, 188, 192 | Sign-in, two-step and passkey lockout (the screens show their own countdown from `retryAfter`; the text is the fallback line) |
| totp_restart_sign_in | Start signing in again with your PIN or passkey. | totp.ts:50 | Two-step sign-in screen |
| totp_code_mismatch | That code didn't match. | totp.ts:58, 75, 164 | Two-step sign-in and turn-off screens |
| totp_enroll_mismatch | That code didn't match. Check your authenticator app's time and try again. | totp.ts:121 | Settings, Two-step sign-in setup |
| totp_already_on (+ next) | Two-step sign-in is already on. | totp.ts:101 | Settings, Two-step sign-in setup |
| passkey_rate_limited | Too many requests. Wait a moment and try again. | passkeys.ts:142 | Sign-in with a passkey |
| no_such_profile | No such profile | passkeys.ts:146, 177 | Sign-in with a passkey |
| no_such_passkey | No such passkey | passkeys.ts:109 | Settings, Passkeys list (remove) |
| sessions_own_only | You can only view your own sessions. | authSessions.ts:67 | Settings, Sessions (away list) |
| no_such_session | No such session | authSessions.ts:101 | Settings, Sessions (sign out a session) |
| trash_restore_missing | This item cannot be restored from your trash. Refresh Trash and try again. | trash.ts:25 | Trash, Restore |
| trash_item_missing | This item is not available in your trash. Refresh Trash and try again. | trash.ts:30 | Trash, Delete forever |
| backup_unreadable | that backup could not be read. Try another one. | backups.ts:140, 341 | Settings, Backups (restore, check) |
| companion_choose | Choose a companion from the list. | conversations.ts:198, 555 | Chat, change companion |
| companion_robot_unavailable | That robot is not available for this side chat. | conversations.ts:202 | Robot side chat |
| companion_unavailable | That companion is not available to you. Choose another from the list. | conversations.ts:205, 556 | Chat, change companion |
| robot_part_unreported | This robot did not report that part. | devices.ts:236 | Settings, Robots, self-test |
| robot_offline | This robot is offline. Check that it is on and on your Wi-Fi, then try again. | devices.ts:241 | Settings, Robots, self-test (code existed already) |
| robot_no_answer | The robot did not answer the test. Restart it, then try again. | devices.ts:245 | Settings, Robots, self-test (code existed already) |
| voice_not_on_hub | That voice is not on this hub. Choose one from the list. | settings.ts:202 | Settings, Voice choice |
| coding_mode_is_max | Coding mode is now Max chat. Pick Max in a chat, or connect a coding app, and Home loads the big model for you. | settings.ts:220 | Settings, Coding |
| setting_key_gone | No such key. Reload the list and try again. | settings.ts:394, 406 | Settings, API keys (rename, revoke) |
| setting_person_gone | No such person. Reload the people list and try again. | settings.ts:418, 446 | Settings, API keys (admin) |
| coding_key_gone | No such coding key. Reload the list and try again. | settings.ts:432 | Settings, Coding keys |
| cannot_disable_self | you cannot disable your own profile | people.ts:305 | Settings, People (disable) |
| guest_stay_ask_adult (minor) | Ask an adult in the household to change how long you stay. | people.ts:310 | A guest's own profile; protected set, stays English until a reviewer writes it |
| house_rooms_unavailable | Rooms are unavailable for this speaker. Sign in as a household member. | house.ts:123 | House app, rooms |
| house_controls_unavailable | Home controls are unavailable for this speaker. Sign in as a household member. | house.ts:155 | House app, controls |
| house_controls_off | Home controls are turned off for this household. Change the House control setting to continue. | house.ts:156 | House app, controls |
| internal (+ next) | Home hit a problem it did not expect. | app.ts:140 (`app.onError`, 500) | any form |
| invalid_input (next only) | Check the fields named and send it again. | lib/openapi.ts (validation hook, 400) | any form; the `error` part names the failed fields at run time and stays as sent |

Counts: 34 codes in the table (33 with an `error` line plus `invalid_input`, which has only a `next`), 51 `apiError(...)` call sites in `backend/src/routes` and
`app.ts`, 1 code added to the validation hook, 15 `useHubMutation` verbs.

## Printed by a screen, text built outside the handler (coded, I18N-B2b)

These routes answered with `error: result.error` from a lib function, so the sentence was composed away from the route. The lib function now
returns a code next to `error`, and the sentence lives only in `API_ERROR_LINES`:

- A lib refusal is built with `refusal(status, "code")` (`lib/result.ts`): the status, the table's English as `error` (so no second copy of the
  words), and the `code`. `refuseWith`, `respond` and `refusalBody` send it as `apiError(code)`; a refusal with no code (a dynamic or developer text)
  goes out as the bare `{ error }` as before.
- `lib/validation.ts` returns the code with each refusal; `lib/passkeys.ts` returns `code` instead of English; `UploadError` takes a table code
  (or `{ text }` for the storage-cap message, which is built from live numbers).
- A line that names a minor (a child, teen or guest reads or acts on it) has an id under `api.minor.*`, so the translate script never fills it.
- No line needed a `{placeholder}`: the three sentences that carried a value (the name length, the project id, the 500 MB cap) now read the same
  without it or keep the fixed number.

| Group | Codes added | Files |
|---|---|---|
| Alarms | 3 (`alarm_invalid`, `alarm_missing`, `alarm_no_next`) | `lib/alarms.ts`, `routes/alarms.ts` |
| Quick timers | 2 | `lib/quickTimers.ts`, `lib/ownedRecordCrud.ts` |
| World places | 4 (invalid, missing, limit, time zone) | `lib/worldPlaces.ts`, `lib/ownedRecordCrud.ts` |
| Coming up | 5 (timer invalid, missing, not pending; item missing, not pending) | `lib/comingUp.ts`, `routes/comingUp.ts` |
| Auth secret checks | 2 (`display_name_length`, `secret_length`) | `lib/validation.ts`, `routes/auth.ts`, `routes/people.ts`; Setup wizard matches the code, not the text |
| Passkey verify | 4 | `lib/passkeys.ts`, `routes/passkeys.ts` |
| Grants | 7 (2 minor) | `lib/grants.ts`, `routes/grants.ts` |
| Lists | 8 (1 minor) | `lib/lists.ts`, `routes/lists.ts` |
| Projects | 2 | `routes/projects.ts` |
| Files and Library | 37 (2 minor): file edit, delete and trash 11, shares 7 (1 minor), picture recheck 3, library cursor 1, uploads 15 (1 minor) | `lib/libraryEdit.ts`, `libraryTrash.ts`, `shares.ts`, `libraryAudience.ts`, `libraryUploadStream.ts`, `libraryMultipart.ts`, `library.ts`, `attachments.ts`, `routes/files.ts`, `routes/library.ts` |

Counts: 74 codes added in this slice, 108 in the table now (34 before). The test `apiErrorCodes.test.ts` also scans these route and lib files and
fails on any `error: "sentence"` literal left in them, except the developer texts below. Real routes are checked for code plus the table's English.

## Developer text (left alone, English)

About 1,080 literal `error:` sites remain. They are of these kinds, and no screen prints them as written:

- Malformed or missing request fields ("scope, key, and value are required", "currentSecret is required", "deviceId is required"): a bug in the caller, not a person's mistake.
- Admin and operator consoles (engine, stack, scheduler, canary, performance, devUi, operator, host): read by the owner or a developer.
- Machine-to-machine routes (openai, codeGateway, quickConnect, deviceAuth, stt, tts, voice streams, turn stream wire errors): read by another program; the chat screen translates its own stream errors through `failureCopy.ts`.
- Internal state errors ("turn not found", "Setup already completed"): the screen prints its own wording for these (for example the Setup wizard on 409).
- Log lines and `console.error` text.
- Still uncoded inside the coded groups (the test allows exactly these): `unknown grant action: <action>` (a caller bug), the joined schema or list
  validation messages (`candidate.error.issues`, `validateList` problems, `validateGrant` problems: built from the field that failed), the zod
  query message for the Library `shared` filter, the storage-cap text on an upload (live numbers), `cancelJob`'s messages passed through
  Coming up "done" and "snooze" (the scheduler's operator texts), and the 500 "attachment integrity check failed" on a file read.

A new route that wants a screen to print its error adds a row to `API_ERROR_LINES` and sends `apiError("code")` (or a lib returns `refusal(status, "code")`); the test in
`backend/tests/apiErrorCodes.test.ts` fails if the table and the routes disagree.
