# ELEMENTS-ADOPT-02a: feedback dialog after a thumbs-down

Decision record, 2026-10-07. Scope: ELEMENTS-ADOPT-02 slice 1, wiring the
kit's `feedback-dialog` Element after a negative reply rating.

## Supersedes

This record supersedes only the FEED-01 frontend interaction description in
`docs/BACKLOG.md` that calls for a hand-built five-reason chip row in
`chatActionBar.tsx`. FEED-01's rating semantics, person/turn ownership, and
review-label intent remain in force. This record does not change
`docs/design/RULES.md` or any age, retention, privacy, or export rule.

## Verdict

**Approved with the constraints below.** The existing rating action can open
the shipped `feedback-dialog` Element, and the Element can collect the
additional adult reasons and optional note, provided the Element is imported
and used as shipped. Do not wrap it in a custom component or override its
classes. This is a direct application of RULES.md rule 9: use the kit Element
when it exists and wire it to Home's data.

## Contract and age gates

- Add the reason choices and optional note to the shared `ReplyFeedback`
  contract first. Keep the current reason values valid and additive; the
  reason and note are fields on the existing person-and-turn feedback record,
  not a second feedback record. Land the new commons spec tag before updating
  Home's pin.
- The dialog is only opened for a negative rating. A child sees no reasons
  form; the server rejects a reason or note submitted for a child, even if a
  client bypasses the UI.
- An optional note from a teen is visible only to that teen. It must not be
  included in household/admin reads, review exports, or any other person's
  view. Do not let the new note field weaken the existing age and surface
  gates.
- Incognito feedback is ephemeral: store no rating, reason, or note. Enforce
  this at the write boundary as well as in the UI.
- Deleting a rating deletes its associated reason and note on every delete
  path. Neither the note nor any newly added reason data is exported; the
  existing feedback export's intended labels remain unchanged unless a later
  separately reviewed design explicitly changes that contract.

## Acceptance boundary

Wire the Element directly and preserve its shipped structure and styling.
Cover child rejection, teen note privacy, Incognito non-persistence, and
cascade deletion in backend/API tests. Capture the opened dialog at 1440px
and 390px in both themes and judge the captures. This approval is limited to
this slice and does not authorize a hand-built fallback or a change to the
authoritative rules.
