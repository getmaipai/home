# Robot voice tools: timers, alarms and announcements (ROBOT-VOICE-01, 2026-11-13)

Owner approved 2026-11-13 ("build the rest out"). Bot side: `bot/docs/dev/stackchan-timers-and-announcements-2026-11-13.md` (Bot 0.2.65).

## What was built

Two native, model-callable tools (virtual tools in `VIRTUAL_TOOL_REGISTRY`, code in `backend/src/lib/robotVoice/`), offered by structure alone (rule 1: the person's words are never read; the model decides when to call):

| Tool | Offered when | Actions or arguments | Device command sent |
|---|---|---|---|
| `robot_timer` | the turn is on surface `robot` with a device id, that device is a StackChan body (check-in `board`), Bot 0.2.65 or newer, its command channel is open, and `robot.timers.enabled` is not false; not for a guest | `set` (seconds), `alarm` (hour, minute), `list`, `cancel` (optional id; none cancels all), `stop`, `snooze` (optional seconds), optional `label` | `timer_set`, `alarm_set`, `timer_list`, `timer_cancel`, `timer_stop`, `timer_snooze` |
| `robot_announce` | an adult (owner, admin, adult band), not a bare turn, with at least one capable body they own (owners and admins: any) with `robot.announce.enabled` on | `text`, optional `urgent` (default false), `robot` (named only when there is a choice) | `announce` |

When the gate fails the tools are not offered, so the existing `timer` and `remind` tools handle the ask (household timers). When a `robot_timer` call finds the body away, unanswered and not received, or answering without `ok`, the tool fails with the kind `unavailable` and the model can use the household `timer` (rule 6, a failed tool never fails the answer).

## Honest results

The hub does not store the robot's answer. `deviceCommands.ts` now holds the ack `state` in memory for the one waiter (`awaitDeviceCommandAck`, resolved in the channel's ack handler) and the tool waits up to 10 seconds. The reply is built only from that state:

- `ok: true` (timer) or `status: "delivered"` (announce): confirmed, said as "Timer set for 10 minutes."
- `ok: false` or `status: "refused"`: the robot's own plain error or the refusal reason (disabled, muted, quiet, night, unreachable, empty), never a success line.
- No answer, robot never received it: the command is withdrawn (`retractUndeliveredDeviceCommand`) so a later reconnect cannot replay a stale timer, and the tool fails so the household path can run.
- No answer, robot did receive it: "I asked the robot to ... but it has not confirmed." Nothing is claimed.
- An ack without `ok` is not success (an older Bot would ack an unknown kind with no detail).

Commands expire in the envelope after 15 seconds (timers) or 60 seconds (announce); the channel's replay ignores `expires_at`, which is why an unreached command is deleted on timeout.

## Rules kept

Age and surface gate (rule 0): announcements are adult-only and refused when search results or a page are in view (policy node); the robot's `announce` path is the same one the settings page button uses. The audit row holds the tool and action name only. No fixed wording replaces the model's answer: the tool result is grounding for the model's reply.

## Spec

Commons `spec-v0.1.383` adds the six timer kinds to `device-command`. Home pins it in this change.

## Not done

- Announcement refusals have no Home notice yet (the Bot note says Home uses its own notice on a refusal). The reply says it was not said; the owner is not separately notified.
- A phrase fixture (`backend/tests/fixtures/robotVoicePhrases.json`) proves call-to-command mapping only; whether a model picks the right call for each phrase is a bench to run (rows `robot-timer-tool`, `robot-announce-tool`).
- Nothing has run against a real robot. A battery-powered StackChan sleeps after 10 idle minutes and cannot ring a timer then (see the Bot note).
