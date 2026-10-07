# ELEMENTS-ADOPT-02a: feedback dialog after a thumbs-down

Architect verdict: approved with constraints, 2026-10-07.

## Supersedes

This design note supersedes any earlier implication in the ELEMENTS-ADOPT-02 backlog row, FEED-01, or chat UI notes that reply feedback is a one-tap thumbs-up or thumbs-down only. It does not supersede `docs/design/RULES.md`; rule 0 (age and surface gates) and rule 9 (shipped Elements) remain authoritative.

## Decision

After an adult or teen gives a thumbs-down, render the kit's `feedback-dialog` Element directly in the reply footer slot. Use the Element as shipped: no Home wrapper and no `className` or CSS overrides. Keep the one-tap thumbs-up path. Reasons and a freeform note are additive fields on `ReplyFeedback` and the feedback route so existing one-tap clients remain valid.

## Constraints

- Extend `ReplyFeedback` in commons first, then update the Home pin and route.
- A child never sees the reasons form; the hub rejects child-band reasons and notes, including forged requests.
- A teen's note is readable only by that teen.
- Incognito persists no feedback data.
- Deleting a rating deletes its reasons and note on every delete path.
- Reasons and notes are excluded from label exports.
- Tests cover child, teen, and adult behavior. Review captures cover 1440 and 390 widths in light and dark themes, with the form opened and visually judged.

## Scope boundary

This decision approves only feedback-dialog slice 1 of ELEMENTS-ADOPT-02. It does not approve the other Elements or data flows in that backlog item.
