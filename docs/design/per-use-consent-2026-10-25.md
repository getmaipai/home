# Per-use consent for adult content of another household adult (2026-10-25)

Status: design only. Nothing here is built. Item: PERUSE-2026-10-25. Owner prompt (Jesse, 2026-10-25): each time an adult asks for a
picture or video that shows another real adult in adult or sexual content, Home asks for a consent before it generates, "so they can
get the approval of the person that's with them." Owner answers the same day: (1) rule 0's Family clause is amended for adult or
sexual content only; ordinary pictures of family stay under the household switch as today; (2) the LIKENESS-SIMPLIFY-01 cleanup
happens first and the approval is built on the simplified base; (3) the pictured adult just clicks a consent button on the current
screen, no PIN, no secret, no passkey, no own-device-only rule; (4) one new commons spec tag is approved, kept minimal.
Architect gate: the `architect` agent rules on this note and the rule 0 edit (section 12).

Read for this note: [RULES.md](RULES.md) rule 0, [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md),
[content-policy-2026-10-18.md](content-policy-2026-10-18.md) (the 2026-10-25 note and "LIKENESS-SIMPLIFY-01"), BACKLOG
LIKENESS-SIMPLIFY-01, `backend/src/lib/likeness/*.ts`, `lib/pictures/{tool,jobs,jobStore}.ts`, `lib/videos/{tool,jobs}.ts`,
`lib/jobs/householdQueue.ts`, `lib/jobQueueCopy.ts`, `chat-cards-2026-10-18.md` section 2.3.

## What does not change

- Rule 0's absolute lines: sexual content that shows a real person outside the household, or a public or historical figure, stays
  blocked for everyone. A photo of a real person never becomes adult content (`PHOTO_ADULT_LINE`). A minor is never a subject and
  teens and children never reach this step. Spoken turns, shared screens and robot turns are refused by the audience gate before
  any ask.
- Ordinary (non-adult) pictures and videos of a household member keep the household option's rule. No ask for them.
- A person making adult content of themselves needs no ask.
- No Stack change: the Stack still checks the signed proof (kept by the cleanup, section 2).

## 1. What triggers an ask

All of these hold:

1. The requester is an adult on their own written screen and passed the picture policy.
2. The request is adult content (`isAdultContentRequest`: the words undress or sexualise, or it also applies an adult-only style).
3. It shows a household adult who is not the requester, through a saved style of that adult (the only way adult content of a
   real person is allowed; photos and prompt-only sexual requests stay refused as today).
4. The household option (after the cleanup, `generation.household_likeness`) is on.

A group scene needs one consent from each pictured adult, up to three; styles still cover one person at a time. Temporary and
ephemeral chats are refused for this ("nothing is kept there, so it cannot be recorded").

## 2. The cleanup comes first

LIKENESS-SIMPLIFY-01 (BACKLOG, design: "LIKENESS-SIMPLIFY-01" in the content policy note) removes the per-person agreement. This
note builds on what remains, so that item is slices 1 to 5 here and lands before any approval slice.

What the cleanup removes: the keys `likeness.adults` and `likeness.adult_content`; `LikenessConsent` records and
`likeness_consent_events`; the use log (`likeness_uses`, `uses.ts`, `likeness.used`, the use list in settings); agreement-only
`consent.ts`, `history.ts` and `revoke.ts` behavior; the old Settings switches and `LikenessSettings.tsx`. What remains and the
approval needs: `generation.household_likeness` (default on), `subjectEligibility` (living household adult), the audience gate,
`decide.ts` reduced to requester gate plus subject eligibility plus household option, `inspector.ts`, the subject binding on saved
styles (`likeness_adapters`), the signed proof (`proof.ts`, kept; the Stack still needs a boundary for style use), and the
`isAdultContentRequest` reading.

What the approval needs that the cleanup deletes: the second switch (`likeness.adult_content`) was the only gate on adult content of a
household adult, and the use log was its only record. After the cleanup adult content of another adult would be allowed with
nothing, so the approval is the replacement gate and its `likeness_asks` row is the replacement record. The cleanup must therefore
land with adult content of a non-self subject refused until the approval ships (a fail-closed step in slice 3), never open.

Is the item's design complete? No. Gaps it must fill before slice 1: it cites 2026-10-18 line numbers that moved after the
2026-10-25 ruling; it has no slice list, file counts or named tests; it does not say what replaces the adult-content gate (this note
does); it does not name the video `rerun.ts`, `POST /api/videos/animate` and `imageEdit.ts` callers of `preparePhotoUse`; it leaves
the proof decision open ("only if still required"; here: kept); and it does not cover the old-backup restore case beyond naming it.

## 3. The flow

1. Sage (adult) asks for adult content with a saved style of Iris (adult). Gates pass.
2. The tool saves a held job and a `likeness_asks` row (`waiting`, 10 minutes) and returns a card: "Iris needs to say yes first."
3. The card shows the exact prompt Home will send, picture or video, count, the style, and "It includes adult content." Two buttons:
   "Consent" and "Decline". Iris, next to Sage, reads it and clicks one on this screen. Iris is also notified on her own devices
   (`likeness.ask`, in app). The bell item opens Settings, Pictures and videos, whose asks list (section 6) shows each waiting ask
   with the same Consent and Decline buttons; the card in Sage's chat is not drawn for Iris.
4. Consent: Home marks the ask `approved`, mints the single-use proof when the job is released to the Stack, and starts it.
5. Decline, timeout, the household option turned off, or Iris becoming ineligible ends the ask; nothing is generated; Sage is told.

Which account clicks: the click is recorded as made from the card's screen. Home does not check who is holding the device. This is a
presence confirmation, not an authentication (section 8).

## 4. Hooks in the existing code (after the cleanup)

| Where | Change |
|---|---|
| `backend/src/lib/likeness/ask.ts` (new) | `openAsk`, `decideAsk`, `expireAsks`, `askApproved`. Only place that touches `likeness_asks`. |
| `lib/likeness/apply.ts` `prepareStyleUse`, `prepareStylesUse` | For an adult-content request with a non-self subject return `ask_needed` with no proof; `preparePhotoUse` still refuses adult content. Self and ordinary requests are unchanged. The proof is minted by `ask.ts` only after `approved`, so no caller can skip the ask. |
| `lib/pictures/tool.ts` `runGenerateImage`, `lib/videos/tool.ts` `runGenerateVideo`, `videos/rerun.ts` | On `ask_needed`: `openAsk`, save the held job, return `data: { likenessAskId }`. "Make another" and retries open a new ask. |
| `lib/pictures/jobs.ts`, `lib/videos/jobs.ts` | Submit a held job when its ask is `approved` (a registered callback so `likeness/` imports no media code); `stopForLikeness` also ends a job whose ask is final and not approved. |
| `lib/jobs/householdQueue.ts` `order()`, `lib/jobQueueCopy.ts` | Skip a job whose ask is not `approved` (like `childDailyCapReached`). New reason `awaiting_approval`. |
| `backend/src/routes/likenessAsks.ts` (new) | `GET /api/likeness/asks/:id` (the card's data for the pictured adult), `POST .../decide` `{decision}`. Caller must be signed in as the requester or the pictured adult; the decision is recorded as `subject_clicked`. No new auth path, no session issued. |
| `lib/notificationTypes.ts` | `likeness.ask`: `time_sensitive`, audience `person`, `privacy: true`, in app, not configurable. |
| Frontend | The waiting card is the job's own card in its queued state (existing picture tool render with `awaiting_approval` copy). The ask is a named render registered in `TOOL_BINDINGS` that returns only the kit `ApprovalCard` (`state="request"`), after a kit change in commons first (rule 9c; the shipped card has fixed Deny, Always allow and Allow once buttons and no room for a prompt): additive `allowLabel` and `denyLabel` props and the exact prompt in its `command` box, with medium, count, style and the adult-content line in `subtitle`. The same Element serves the asks list in Settings, Pictures and videos. No wrapper around an Element. |

## 5. State table

| From | Event | To | Effect |
|---|---|---|---|
| (none) | tool opens an ask | `waiting` | held job saved, notification, `expires_at` = now + 10 min |
| `waiting` | Consent clicked | `approved` | `decided_at`; job becomes eligible |
| `waiting` | Decline clicked | `declined` | job `failed` (decline line), prompt text cleared, cool-down starts |
| `waiting` | 10 minutes pass | `expired` | job `failed` (timeout line), prompt text cleared |
| `waiting` | requester cancels | `cancelled` | job `cancelled`, text cleared |
| `waiting` or `approved` | household option off, or subject ineligible | `cancelled` | job stopped, requester told |
| `approved` | job released to the Stack | `consumed` | proof minted, `consumed_at` |
| `approved` | prompt hash mismatch at release | `cancelled` | job `failed`, nothing sent |
| `approved` | not released within 4 hours | `expired` | job `failed` |

Final states: `declined`, `expired`, `consumed`, `cancelled`. One ask, one generation. A decline blocks the same prompt from the
same requester to the same person for one hour; at most 3 asks per requester and person per hour. Sweeps run on read and on the boot
and five-minute pass.

## 6. The audit record

The cleanup retires `likeness_uses`, so the ask is the record. New shared spec record `LikenessAsk` (the one new tag): id,
`subject`, `requester`, `medium`, `way`, `state`, `prompt_sha256`, `created_at`, `decided_at`, plus the standard provenance and clock
stamp. Prompt text is stored only on the Home row while `waiting` or `approved` and cleared at any final state, so no prompt lives in
a log. The pictured adult reads their own asks (who, when, consented or declined) in Settings, Pictures and videos, which the cleanup
keeps as the household option's page; no new page. The requester sees only their own. Rule 6a: no log or trace event carries an ask
id, a person id or the hash; typed events with counts only; no admin page reads `likeness_asks`. Backups include the table without
prompt text.

## 7. Copy

Requester card: "Iris needs to say yes first. Show her this screen." Queue reason `awaiting_approval`: "Waiting for Iris to say yes.
It starts as soon as she does." Notification: "Sage wants to make a picture of you. Open Home to read it and say yes or no."

Pictured-adult card, title: "Sage wants to make a picture that looks like you". Body: "This is exactly what will be made:", the
prompt, "1 picture, with your saved style", "It includes adult content." Buttons: "Consent", "Decline".

Outcomes to the requester: "Iris said yes. Making it now." / "Iris said no. Nothing was made." / "Iris did not answer in 10 minutes.
Nothing was made. Ask again when she is with you." / "Iris can no longer be asked. Nothing was made." / "The request changed after it
was approved. Nothing was made. Ask again." / temporary chat: "Adult content of another person can't be made in a temporary chat,
because nothing is kept there. Use a normal chat." Every line names the problem and the next step.

## 8. Risks and edge cases

- Presence confirmation, not authentication. Anyone using the screen can click Consent, including the requester, who could
  click for Iris. The design makes this harder to do by accident (the exact prompt is shown, the click is recorded, Iris is notified
  on her own devices and sees the record) and gives Iris after-the-fact visibility, but it does not prove who clicked. Jesse chose this
  (2026-10-25). A later upgrade to a secret check would be one added step in `decideAsk` and does not change the rest.
- Pictured adult not in the household: not supported for adult content (it stays blocked: outside people and public figures).
  Supported now: add them as a household adult account. Guests are not eligible. For non-sexual pictures of an outside real adult the
  2026-10-25 ruling stands: no consent step, because nobody can be asked.
- Prompt-only naming of a household adult in non-adult content: no ask (ordinary family content, household option).
- Restart while `waiting`: rows survive; the sweep expires them.
- A finished item that shows Iris carries her in its provenance; animating or editing it asks again.
- Backups restored from before the cleanup cannot restore agreement-based permissions (cleanup requirement).

## 9. Slices (cleanup first)

Cleanup, LIKENESS-SIMPLIFY-01 (each lands alone; adult content of a non-self subject is refused from slice 3 until slice 9 ships):

1. **Spec, commons first** (`spec/schemas/settings keys`, `likeness-consent`/`likeness-use` retirement, new key `generation.household_likeness`; tag needs the cut Jesse approved). Tests: conformance fixtures.
2. **Pin, settings keys and migration** (pin via `scripts/pin.sh`, `backend/src/settings/likenessKeys.ts`, `backend/src/lib/settings.ts` hooks, forward migration dropping `likeness_consent_events` and `likeness_uses`). Tests: retired-key errors, old values grant nothing, old backup restore.
3. **Decision and jobs** (`lib/likeness/decide.ts`, `apply.ts`, `guard.ts`; delete `consent.ts`, `history.ts`, `uses.ts`, agreement part of `revoke.ts`; tool callers drop `recordLikenessUse`). Adult content for a non-self subject refused fail-closed. Tests replace `likenessConsent.test.ts` and `likenessUse.test.ts`: household on/off, minor subject, queued job withheld when off, unknown identity.
4. **Settings UI and API** (`frontend/src/apps/settings/LikenessSettings.tsx`, `frontend/src/lib/likenessApi.ts`, `settingsViews.tsx`, `personLimits.ts`). Tests: page tests.
5. **Notices and routes** (`lib/notificationTypes.ts` drop `likeness.used`, `routes/likeness.ts`, `importStyle.ts` notice). Tests: route payloads, style import.

Approval (after slice 5; behind `likeness.per_use`, default off until Jesse tests):

5b. **Kit, commons first** (`ApprovalCard` additive `allowLabel`, `denyLabel`; its story and test; needs a new ui tag, which only Jesse says yes to: open question 1).
6. **Spec, commons** (`LikenessAsk` schema, the one tag). Then pin and `likeness_asks` table with migration (`backend/src/db/schema.ts`, migration).
7. **Ask store and route** (`lib/likeness/ask.ts`, `routes/likenessAsks.ts`, `lib/notificationTypes.ts`). Tests (`backend/tests/likenessAsk.test.ts`): open, consent, decline, expire, cancel on option off, cool-down, hash mismatch, only requester or subject may decide, no session issued, no proof before approval.
8. **Picture, video and queue hook** (`lib/likeness/apply.ts`, `lib/pictures/tool.ts`, `lib/videos/tool.ts`; second commit `lib/pictures/jobs.ts`, `lib/videos/jobs.ts`, `householdQueue.ts`, `jobQueueCopy.ts`). Tests: held job does not submit until approved; self needs no ask; ordinary requests need none; Make another asks again.
9. **Card and asks list** (`frontend/src/apps/chat/elementBindings.ts`, one named render, the asks list rows in the Settings Pictures and videos page, locale strings; pin of the slice 5b ui tag). Tests: shows the exact prompt, decline path, 390 px and desktop screenshots opened. Flips the flag after the dev preview is checked.

## 10. Supersedes

- RULES.md rule 0, Family clause and the "own adult-content consent" wording: amended in this change (`Owner-approved: 2026-10-25`):
  a household adult's adult content needs that adult's per-use consent click; ordinary family content stays under the household option.
- The per-person agreement for adult content (`likeness.adult_content`) in [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md),
  and its "subject is told each time, after the fact" limit.
- The use log as the audit record: LIKENESS-SIMPLIFY-01 retires it, and `likeness_asks` replaces it for this one case.
- LIKENESS-SIMPLIFY-01 itself is not superseded: it is slices 1 to 5 here, with the gaps in section 2 added to its row.

## 11. Reuse check

Reused: `decideLikeness` (reduced), `subjectEligibility`, `isAdultContentRequest`, `mintProof`/`ensureStackTrust`, the household
option, the household queue and `JOB_QUEUE_COPY`, the notification bell, kit `ApprovalCard`, `TOOL_BINDINGS`, Settings, Pictures
and videos. Not reused, with reason: `approvals.ts` (an adult-session decider for installs, no per-generation binding), `/verify-secret`
(no secret step now), the `confirmation` answer block (a result row, not a gate), FORM-CHAT asks (not built, keep values out of the
trace). New: one table and spec record, one lib file, one route file, one card render.

## 12. Open question for Jesse

1. The card needs a small additive change to the shared kit (button labels so it can say Consent and Decline) and so a new ui tag. You approved a spec tag; say yes to this ui tag too, or accept the shipped words Allow once and Deny.

## 13. Architect verdict

Item PERUSE-2026-10-25. First ruling NEEDS-RULE-CHANGE (rule 0; amended by Jesse, 2026-10-25). Second ruling REJECTED on rule 9c (the shipped `ApprovalCard` cannot show Consent, Decline or the prompt); fixed by slice 5b above and by naming the asks list as the pictured adult's own-device surface.
