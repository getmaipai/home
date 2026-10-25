# Per-use consent for pictures and videos of another adult (2026-10-25)

Status: design only; ruled NEEDS-RULE-CHANGE by the architect (section 13): rule 0's Family clause and open item LIKENESS-SIMPLIFY-01 need Jesse's decision first. Nothing here is built. Item: PERUSE-2026-10-25. Owner prompt (Jesse, 2026-10-25): each time an adult asks for
a picture or video that shows another real adult, including adult content of a household adult, Home asks for a consent before it
generates, "so they can get the approval of the person that's with them." Decided before this note: a plain click by the requester is
not consent (the requester could lie), so the approval comes from the pictured person, is verified, is given for that one generation
only, and shows the exact prompt. Architect gate: the `architect` agent rules on this note before any slice starts (section 12).

Read for this note: [RULES.md](RULES.md) rule 0 and its owner-approved notes, [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md),
[content-policy-2026-10-18.md](content-policy-2026-10-18.md) (the 2026-10-25 note), [chat-cards-2026-10-18.md](chat-cards-2026-10-18.md)
section 2.3, `backend/src/lib/likeness/{decide,apply,guard,uses,history,resolve,proof,revoke}.ts`,
`backend/src/lib/pictures/{tool,jobs,jobStore}.ts`, `backend/src/lib/videos/{tool,jobs}.ts`, `backend/src/lib/jobs/householdQueue.ts`,
`backend/src/lib/jobQueueCopy.ts`, `backend/src/routes/auth.ts` (`verifyAgainstRecord`, `/verify-secret`), `backend/src/lib/secret.ts`,
`backend/src/lib/credentialLockout.ts`, `backend/src/lib/approvals.ts`.

## What does not change

- Rule 0 and the content policy stay as written. Sexual content that shows a real person outside the household, or a public or
  historical figure, stays blocked for everyone. A photo of a real person never becomes adult content. A minor is never a subject
  and never a requester of a person's likeness. Teens and children never reach this step (the audience gate in `decideLikeness`
  runs first).
- The two standing switches (`likeness.adults`, `likeness.adult_content`) stay and still gate everything. They answer "may anyone
  ask me at all". The new step answers "do I say yes to this one".
- Spoken turns, shared screens and robot turns never start an ask: the picture policy refuses them before any likeness decision.
- No Stack change. The Stack already refuses a request without a valid single-use proof (`stack/backend/src/lib/likeness.ts`).

## 1. Who needs to approve

A request needs a per-use approval when all of these hold:

1. The requester is an adult on their own written chat screen (or the editor) and passed the picture policy.
2. The picture or video shows a household adult who is not the requester. Three ways it can: a saved style of that adult
   (`prepareStyleUse`, `prepareStylesUse`), a photo of that adult (`preparePhotoUse`), or a prompt that names that adult with no
   style or photo (new, section 6).
3. The pictured adult has `likeness.adults` on. If it is off the request is refused today and stays refused; no ask is created.

The requester making a picture of themselves needs no ask and nobody is notified (unchanged). A group scene with two or more
pictured adults needs one approval from each, up to three people; a fourth is refused with "I can show up to three people from this
household in one picture." Styles still cover one person at a time (`MANY_PEOPLE_LINE`, unchanged).

## 2. The flow

1. Sage (adult) asks in written chat for a picture of Iris (adult) at the beach. The turn runs the existing gates and
   `decideLikeness`. It passes.
2. The tool does not start a job. It writes a `likeness_asks` row (state `waiting`, expires in 10 minutes) and returns a card:
   "Iris needs to say yes first."
3. Sage's screen shows the card with the exact prompt and one button: "Hand the device to Iris". Iris is also notified on her own
   devices (`likeness.ask`, in app) and can answer there.
4. The approval dialog opens (on Sage's screen, or on Iris's own device after she signs in). It shows who is asking, picture or
   video, the exact prompt Home will send, how many, any style, and a plain line if it includes adult content. Iris types her own
   sign-in secret (PIN or password, plus her code if she uses one) and presses Approve, or presses Decline. Decline needs no secret.
5. Home checks the secret against Iris's record (not a session), marks the ask `approved`, mints the single-use proof for that
   one generation and starts the job. The card turns into the normal picture card. `recordLikenessUse` writes the history row.
6. Decline, timeout, or the pictured person turning their switch off while waiting ends the ask. Nothing is generated and the
   requester is told in plain words.

Who sees what: the requester sees the waiting card and the outcome line, never the secret. The pictured adult sees the prompt
only inside the dialog and in the notification text ("Sage wants to make a picture of you."), and sees the full prompt only after
opening the dialog. Nobody else in the household sees the ask.

### Where the pictured adult enters the secret

Only in the approval dialog. It is a kit `AlertDialog` with the sign-in secret field the profile sign-in already uses
(`useProfileSignIn.ts`, the PIN pad or password field per `secretDigits`). Shipped parts only, tokens only, no new status UI: the
waiting card feeds the existing job queue card copy (`JOB_QUEUE_COPY`), per the "reuse status mechanisms" rule.

The check is a new route, `POST /api/likeness/asks/:id/decide`, not `/verify-secret`. `/verify-secret` issues a session cookie; this
must not sign Iris in on Sage's device. The route:

- accepts the caller only if the caller is the ask's requester (device handoff) or the ask's subject (own device);
- ignores any person id from the client: the person verified is `ask.subjectPersonId`, always;
- runs the same IP throttle, lockout counter and `verifySecret` as sign-in (extract `verifyAgainstRecord` from
  `routes/auth.ts` into `lib/secretCheck.ts`; auth.ts then calls it, so there is one definition);
- requires the TOTP code too when `isTotpEnabled(subject)` (owner and admin who set it);
- rejects the requester's own secret (the subject must be a different person);
- on success issues no session and sets no cookie.

A wrong secret counts toward the subject's normal lockout (5 attempts), so Sage cannot guess Iris's PIN by retrying the dialog.
A locked subject sees "Too many tries. Try again in N minutes." and the ask stays waiting.

### Timeout, decline, and what the job holds

- Timeout: 10 minutes from creation (`expires_at`). Swept on every read and by the same boot and five-minute pass that removes
  revoked styles (`revoke.ts`). After it the ask is `expired` and the dialog cannot approve it.
- Decline: the ask is `declined` and the requester sees "Iris said no. Nothing was made." The same prompt from the same requester
  to the same person is not asked again for one hour (a cool-down, so a no is not worn down); a different prompt is allowed but at
  most 3 asks per requester and person per hour.
- Waiting job: before approval there is no Stack job and no proof. The picture or video job record exists in Home (state `queued`
  with `request.likeness.ask = { id, state }`) so the chat card has something to bind to; `order()` in `householdQueue.ts` skips a
  job whose ask is not `approved`, the same way it skips `childDailyCapReached`. The job holds the prompt, the choices
  (size, count, quality, style id or photo id) and the ask id. It holds no proof and no secret.
- Approval: the ask stores `prompt_sha256` of the text Home will send. At release Home recomputes it from the job; a mismatch
  ends the job as `failed` ("The request changed after it was approved. Nothing was made."). The proof is minted when the job is
  released to the Stack, not when approved, so a long queue wait cannot outlive the 20-minute proof.
- One ask, one generation: the ask gets `consumed_at` when the job is released. "Make another", a variation, an animate-this-picture
  and a retry after failure each open a new ask.

## 3. Hooks in the existing code

| Where | Change |
|---|---|
| `backend/src/lib/likeness/ask.ts` (new) | `openAsk`, `decideAsk`, `expireAsks`, `askStillValid`, `mintForApprovedAsk`. The only place that reads or writes `likeness_asks`. |
| `lib/likeness/apply.ts` `prepareStyleUse`, `prepareStylesUse`, `preparePhotoUse` | For a non-self subject, return `kind: "ask_needed"` with the subject, medium, way, adult flag and the exact text, and no `proof`. For self the result is unchanged. Because the proof is no longer minted here, a caller cannot skip the ask. |
| `lib/likeness/decide.ts` `decideLikeness` | Unchanged. Add `LIKENESS_LINES` for ask outcomes (section 7). |
| `lib/likeness/guard.ts` `likenessStillAllowed`, `JobLikeness` | `JobLikeness` gains `ask: string` for non-self. `likenessStillAllowed` also fails a job whose ask is `declined`, `expired` or `cancelled`. |
| `lib/likeness/revoke.ts` | A switch turned off also cancels that person's `waiting` asks. |
| `lib/likeness/uses.ts` `recordLikenessUse` | Called when the ask is approved and the job starts, as today. Adds the ask id (section 5). |
| `lib/pictures/tool.ts` `runGenerateImage` (after `prepareStyleUse`, before `startPictureJob`) | On `ask_needed`: `openAsk`, save the held job, return an outcome with `data: { pictureJobId, likenessAskId }`. Also the prompt-named path (section 6). |
| `lib/pictures/jobs.ts` `startPictureJob`, `stopForLikeness` | Accept a held job; start submitting it when its ask is approved (a registered callback, like `registerRevokeHandler`, so `likeness/` imports no pictures code). |
| `lib/videos/tool.ts` `runGenerateVideo` (photo branch near line 136, style branch near line 187), `videos/rerun.ts`, `POST /api/videos/animate`, `lib/imageEdit.ts` (editor preview and Apply) | Same hook. The editor already re-checks consent on Apply; it asks first. |
| `lib/jobs/householdQueue.ts` `order()`; `lib/jobQueueCopy.ts` | Skip jobs with an unapproved ask. New `JobQueueReason` `awaiting_approval` with adult copy (section 7). |
| `backend/src/routes/likenessAsks.ts` (new) | `GET /api/likeness/asks/:id` (what the dialog shows), `POST .../decide`. Mounted beside `routes/likeness.ts`. |
| `lib/notificationTypes.ts` | New `likeness.ask` beside `likeness.used`: `time_sensitive`, audience `person`, `privacy: true`, in app, not configurable. |
| Frontend | The waiting card is a chat card bound by `TOOL_BINDINGS` in `frontend/src/apps/chat/elementBindings.ts` (the path `PictureToolRender` uses). The waiting card is the picture or video job's own card in its queued state (existing `PictureToolRender`, fed the `awaiting_approval` queue copy), not a new surface. The dialog is a named render registered in `TOOL_BINDINGS` that returns only kit parts: `ApprovalCard` (`state="request"`) for the ask, kit `PasscodeInput` for the secret (as `SignInPage.tsx` uses it), and the prompt in a kit quote part, never a Home box with its own border or background. No wrapper around an Element (rule 9, 9b). |

## 4. The state table

Ask state (`likeness_asks.state`):

| From | Event | To | Effect |
|---|---|---|---|
| (none) | tool opens an ask | `waiting` | held job saved, notification sent, `expires_at` = now + 10 min |
| `waiting` | subject approves with a correct secret | `approved` | `decided_at`, `decided_via` (`requester_device` or `own_device`), job becomes eligible |
| `waiting` | subject declines | `declined` | job `failed` with decline line, prompt text cleared, cool-down starts |
| `waiting` | 10 minutes pass | `expired` | job `failed` with timeout line, prompt text cleared |
| `waiting` | requester cancels the card | `cancelled` | job `cancelled`, prompt text cleared |
| `waiting` | subject turns `likeness.adults` off, or account is removed or becomes ineligible | `cancelled` | same, requester told "Iris took back her agreement." |
| `approved` | job released to the Stack | `consumed` | proof minted, `consumed_at`, use row written |
| `approved` | subject switch turned off before release | `cancelled` | job stopped by `likenessStillAllowed`, as for any waiting job |
| `approved` | prompt hash mismatch at release | `cancelled` | job `failed`, nothing sent |
| `approved` | job not released within 4 hours | `expired` | job `failed` |

Wrong secret: no state change; counts toward lockout. `approved`, `declined`, `expired`, `consumed` and `cancelled` are final.

## 5. The audit record

Reuse the likeness use history (`likeness_uses`, spec `LikenessUse`, read by the subject in Settings, Pictures and videos).
One row is still written per generation, when the job starts. The row gains two fields: `ask_id` (the ask that approved it) and
`approval` (`per_use`). The ask itself is a small hub-internal record, `likeness_asks`: id, subject, requester, medium, way,
adult_content flag, `prompt_sha256`, `state`, `decided_via`, `created_at`, `expires_at`, `decided_at`, `consumed_at`, and the clock
stamp. It holds the prompt text only while `waiting` or `approved`; at any final state the text is cleared and only the hash stays,
so no prompt lives in a log. Declines and timeouts also show in the subject's list as one line each ("You said no to Sage's
picture request"), because the subject should be able to see who is asking. The requester sees only their own asks.

`LikenessUse` is a shared spec shape, so the two new fields go in `commons/spec` first (slice 1), then the hub (principle 3, rule
"spec first"). Adding a spec tag needs Jesse's yes (open question 4).

## 6. Prompt-only naming of a household adult

Today a prompt that names a household adult, with no style or photo, is an ordinary non-sexual picture (owner ruling 2026-10-25).
Jesse's rule covers it. The model carries a new optional tool argument `people_shown` (names the requester used). Home resolves each
name with `resolveDeclaredAdult` against the household roster (trusted identity context, not a word list of names), and requires
the requester's own message to contain the name (`messageAttests`), as the photo path already does. As a backstop for a model that
leaves the argument out, `lib/likeness/ask.ts` also matches the sent prompt against the roster's adult names and nicknames (whole
word). A match asks; a false match (a household adult sharing a name with a character) costs one extra yes, and the dialog shows
the prompt so the person can approve it. Limits: a nickname or description the roster does not hold ("my brother") is not matched;
the model's `people_shown` is the only help there. Sexual prompt-only content of a real person stays blocked by the prompt policy
as today; this path adds consent to non-sexual requests only.

## 7. Copy

Adult requester, waiting card: "Iris needs to say yes first. Hand her the device, or she can answer on her own." Button: "Hand the
device to Iris". Secondary: "Cancel". Queue reason `awaiting_approval`: "Waiting for Iris to say yes. It starts as soon as she does."

Pictured person, notification: "Sage wants to make a picture of you. Open Home to read it and say yes or no." (video: "a video".)

Pictured person, dialog title: "Sage wants to make a picture that looks like you". Body: "This is exactly what will be made:" then
the prompt in a quoted block, then "1 picture, with your saved style" or "1 picture from your photo", then, only when it applies,
"It includes adult content." Field label: "Type your PIN to say yes" (or "password"). Buttons: "Yes, make it", "No". Under the field:
"Only you can say yes. Your PIN is not shown to Sage."

Outcomes to the requester: "Iris said yes. Making it now." / "Iris said no. Nothing was made." / "Iris did not answer in 10 minutes.
Nothing was made. Ask again when she is with you." / "Iris took back her agreement. Nothing was made." Wrong secret: "That PIN is
not right. You have N tries left." Locked: "Too many tries. Try again in N minutes." Request changed after approval: "The request
changed after it was approved. Nothing was made. Ask again." Temporary chat: "Pictures of another person can't be made in a
temporary chat, because nothing is kept there. Use a normal chat."

Every message names the problem and the next step (org error rule). Names are the persona's display name or nickname.

## 8. Edge cases

- Pictured adult not in the household. Supported now: add them as a household adult account (role adult, with a PIN), then they can
  agree and approve. Not supported: a guest profile (`subjectEligibility` refuses guests), anyone with no account, a person who
  has only a passkey and no PIN (they set a PIN first; passkey approval is a follow-up, question 3). For a real adult outside the
  household, non-sexual pictures stay allowed with no consent step because nobody can be verified (owner ruling 2026-10-25, a
  limit stated here, question 1); sexual content stays blocked for everyone, and a public or historical figure is never asked.
- Shared screen, spoken turn, robot, Go: refused before any ask (audience gate). The approval dialog is written-screen only and is
  never shown on a screen that is shared or has other people present.
- The requester tries their own secret in the dialog: refused ("The person in the picture has to say yes, not you.").
- Shoulder-surfing: the PIN is typed on the requester's device. Masked input, shared lockout, and own-device approval are the
  mitigations; the limit is stated to Jesse (question 2).
- Where Iris answers on her own device (rule S6): the `likeness.ask` bell item opens the requester's chat card for her in a read-only view with the same `ApprovalCard`; if the ask is not in a chat she can see, it opens Settings, Pictures and videos, which already lists her likeness uses and gains one pending row at its top. No new inbox, page, banner, dot or toast.
- Logs (rule 6a): no log or trace event carries an ask id, a person id or `prompt_sha256`; typed events with counts only. No admin page reads `likeness_asks`.
- Two asks for the same person at once: each is separate; the dialog lists them one at a time, oldest first.
- Restart or crash while `waiting`: rows survive; the sweep expires them. A held job with no live ask fails with the timeout line.
- Subject removed, made a minor by birthdate, or set to memorial while waiting: ask cancelled (`subjectEligibility`).
- Requester's role changes to teen or guest while waiting: `decideLikeness` fails at release; job fails.
- Backups: `likeness_asks` is included in the backup set with no prompt text (final states clear it).
- A picture of Iris approved once is not reusable: the finished file's provenance still carries Iris, so animating or editing it
  later asks again, as before and now with a fresh approval.
- Pictures made before this ships keep their existing consent; nothing is re-asked retroactively.

## 9. Slices

Each is 1 to 3 files plus its test, lands alone, and does not turn the ask on until slice 4 (a flag, `likeness.per_use`, default off
until Jesse's test, then on).

1a. **Spec, in commons first** (`spec/schemas/likeness-use.json`, new `spec/schemas/likeness-ask.json`; needs Jesse's yes to the tag). `LikenessUse` gains `ask_id` and `approval`; new `LikenessAsk` (id, provenance, clock stamp, the fields in section 5) because it crosses the wire. Test: conformance fixtures.
1b. **Pin and schema** (home pin via `scripts/pin.sh`, `backend/src/db/schema.ts`, migration). Test: old rows still read.
2. **Ask store and secret check** (risky surface: auth work; full `check.sh`, `code-review` at medium, load `docs/CREDENTIALS.md`) (`backend/src/lib/likeness/ask.ts`, `backend/src/lib/secretCheck.ts`, `backend/src/routes/auth.ts`
   edit to call it). Tests (`backend/tests/likenessAsk.test.ts`): open, approve, decline, expire, cancel on revoke, cool-down,
   hash mismatch, wrong secret counts toward lockout, requester's own secret refused, no session issued, TOTP required when set.
3. **Route and notification** (`backend/src/routes/likenessAsks.ts`, `lib/notificationTypes.ts`, route registration). Tests: only the
   requester or subject may call; the client person id is ignored; response never contains the prompt to anyone else.
4. **Picture hook and queue** (`lib/likeness/apply.ts`, `lib/pictures/tool.ts`, `lib/pictures/jobs.ts`). Tests: a style of another
   adult makes no job submit until approved; self needs no ask; proof minted only at release; the prompt-named path asks; revoke
   cancels a waiting ask; adult-content asks carry the flag and still need both switches. Also `householdQueue.ts` and
   `jobQueueCopy.ts` (second commit if over three files).
5. **Video, editor and rerun hook** (`lib/videos/tool.ts`, `lib/videos/rerun.ts`, `lib/imageEdit.ts`). Tests: animate, make another
   and editor Apply each open a new ask; photo adult content is still refused before any ask.
6. **Card and dialog** (`frontend/src/apps/chat/elementBindings.ts`, one new dialog component, `frontend/src/locales` strings).
   Tests: dialog shows the exact prompt, no secret in page state after submit, decline needs no secret, phone width check, opened
   screenshot at 390 px and desktop. Also flips the flag after the dev preview is verified.

## 10. Supersedes

- The "subject is told each time, after the fact" line under "Not built, and limits" in
  [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md): for a non-self subject the subject now approves before, and the
  notification is the ask.
- The LIKENESS-SIMPLIFY-01 section of [content-policy-2026-10-18.md](content-policy-2026-10-18.md) and open backlog item LIKENESS-SIMPLIFY-01 (it retires the switches, `likeness_uses` and `likeness.used`; this note keeps and extends them). Jesse must cancel or rescope it.
- The standing-switch-only consent for a non-self subject in `prepareStyleUse`, `prepareStylesUse` and `preparePhotoUse` (they no
  longer mint the proof themselves).
- The 2026-10-25 reading that a non-sexual prompt naming a household adult needs no consent (section 6); it now needs a per-use yes.
  The ruling for outside people and public figures is untouched.

## 11. Reuse check

Reused: kit `ApprovalCard` and `PasscodeInput`, `decideLikeness`, `subjectEligibility`, `consentState`, `mintProof`/`ensureStackTrust`, `likenessStillAllowed` and the
revoke sweep, `recordLikenessUse` and `likeness_uses`, `resolveDeclaredAdult` and `messageAttests`, `verifySecret`, the lockout
counter and IP throttle, `isTotpEnabled`, the household queue and `JOB_QUEUE_COPY`, `TOOL_BINDINGS`, the kit `AlertDialog` and the
profile secret field. Not reused, with reason: `approvals.ts` (its "request, decided once by an adult" shape fits installs, but its
decider is any adult's session and has no secret step), `/verify-secret` (it issues a session), the answer-block `confirmation` kind
(a result row with Undo, not a gate), the form-in-chat asks (FORM-CHAT-HUB-01 is not built and its values are kept out of the trace
by design; this ask must keep the prompt visible). New: one table, one lib file, one route file, one card, one dialog.

## 12. Open questions for Jesse

1. A real adult who is not in the household: today non-sexual pictures of them need no consent (your 2026-10-25 ruling) because
   nobody can verify them. Keep that, or refuse until they have an account here?
2. Same-device PIN entry can be watched. Allow the pictured person to answer on their own device too (recommended), or only on the
   requester's device?
3. Passkey-only adults have no PIN. Require a PIN first (recommended for v1), or build passkey approval in slice 3?
4. Adding `ask_id` and `approval` to the shared `LikenessUse` record needs a new commons spec tag. Say yes to the tag?
5. Cancel or rescope LIKENESS-SIMPLIFY-01 (it retires the two switches and the use history)? Recommended: cancel it, keep both switches plus the per-use yes.
7. Amend rule 0's Family clause to add: "A picture or video that shows a household adult other than the requester needs that adult's verified yes for that one generation"? Only you change a rule.
6. Wait time 10 minutes, cool-down 1 hour after a no, 3 asks per hour per pair: fine, or other numbers?

## 13. Architect verdict

Item PERUSE-2026-10-25: NEEDS-RULE-CHANGE (record `data-scratch/architect/PERUSE-2026-10-25.verdict`). Blockers: rule 0 Family clause reads the household option as the gate, and LIKENESS-SIMPLIFY-01 retires the parts this note extends. Fixes for rules 9, 9b, S6, 6a, spec-first and the risky surface are applied above; a re-run follows Jesse's decision on questions 5 and 7.
