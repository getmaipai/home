# Status surfaces: a design review (2026-10-29)

Asked by Jesse after a person saw a raw engine sentence about memory when they pressed a picture button. This is a review of how Home
shows system status and gates functionality on it, against four questions he asked: is there a floating status you can minimize, does the
person hear when things are normal again, how prominent is each status, and does the whole thing hold when we extend it to pictures and
video. It records what exists (read from RULES.md S6, `useChatAvailability.ts`, `StatusIndicator.tsx`, `InstallDock.tsx`, `mediaBudgetToast.test.tsx`
and the code), what is missing, and the decisions it needs. It changes no rule.

## What exists today

| Status | Surface | Prominence | Moves or floats? | Says when it is over? |
|---|---|---|---|---|
| Chat starting, paused, unavailable | composer line, Send hold, Welcome state, spoken line | in the place the person is acting, one line | no, anchored | no: the line and the hold simply go away |
| Engine setup, model downloads | the install dock (`InstallDock.tsx`, collapsible row) and the strip | one line while it runs, a collapsible panel for detail | a dock that opens and closes, not floating | the row goes away; a failed one stays |
| Something needs fixing | Repairs item with Try again | owner and admin only | no | resolved items leave the list |
| Whole system | header pill, rail profile menu, Status page | a dot and a word | no | the dot returns to online |
| One job | that job's own card | where the person started it | no | the card shows done |
| Needs an admin | the bell | a count | no | cleared when read |
| A form or action failed | the kit destructive Alert in that form | next to the action | no | on the next try |

There is no floating status, and no status that appears from nowhere and can be minimized, except the install dock. The only transient notice
is a toast (screen time used up, the media guard). Nothing tells a person that a thing which was paused has recovered.

## The gaps this exposes

1. **Pictures and video have no readiness row.** Chat, embed, background and voice have one (`roleHealth.ts`); pictures and video do not. So no
   control can be disabled in advance, and the person learns the state from a refused request (the raw Stack sentence). S6 already says a
   failure that coincides with a not-ready state is reported as that state; media was never given a state to report. Fix in progress
   (agent in worktree `engine-status-media`): health roles `image` and `video`, one availability hook, controls disabled with the line.
2. **A pause reads as an error, not as a state.** Chat's line is a calm state with a hold. A button that fails after the click is an error.
   The review rule: if Home can know it before the click, the control is disabled and the surface says why; an error is only for what Home
   could not know.
3. **Nobody is told when it is back.** A person who waited for the pause to end watches a line vanish. For a short pause that is right (no
   noise). For a pause that interrupted something they asked for, they should hear it.
4. **Prominence is not defined.** Each surface chose its own weight. There is no ladder saying how loud a status may be for how long.

## Recommendation

**Prominence ladder** (one rule for every surface, tuned by what the person is doing):

| Level | Used when | Shown as |
|---|---|---|
| Quiet | a state that does not affect what they are doing right now | the header pill and Status page only |
| In place | the thing they are about to do is disabled or waiting | one line where they act (composer line, a line above the disabled button), and the control is disabled with the same reason |
| Interrupt | something they asked for stopped or finished late | a toast, once, that can be dismissed, with the next step |
| Admin | a person cannot fix it | Repairs and the bell, never the person's screen |

**Recovery rule.** When a status that disabled a control returns to normal: the line disappears; the control re-enables; and only if the
person had a request waiting on it (a queued picture, a clip run, a message they tried to send) is a single "Back to normal, it is going
again" toast shown, once, and only if the person is still on the screen. No toast otherwise. It reuses the one kit Toast, so this is not a new
status UI.

**No new floating panel.** A floating minimizable status would be a new status surface (S6: needs an architect verdict, and is DUPLICATE
when an existing mechanism covers it). The install dock already is the collapsible docked panel; the recommendation is to let it carry
"paused for memory" as one more row for admins rather than add a second dock.

**One readiness function per concern**, as S6 says. Pictures and video get theirs; later engines (music, speech to text, vision) follow the
same three steps (health row, copy with no figures, the hook), written in `docs/dev/engine-status.md`.

## Decisions for Jesse

1. Adopt the prominence ladder as the rule every status follows (a one-row addition under S6, owner-approved).
2. Show the one-time "back to normal" toast only when a request was waiting (recommended), always, or never.
3. Keep the install dock as the only collapsible status, with media pauses as an admin row in it (recommended), or add a floating one.
4. Child accounts: keep the existing child rule (a child sees the line where they act and no pill), applied to pictures and video too.

## Not verified

This is a read of the rules and code, not a user test. I did not check how each surface renders at phone width, and I did not read every
app for a bespoke status message; the engine-status agent's audit lists the raw-error call sites it finds.
