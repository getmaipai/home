# Engine status: giving a role the chat treatment

Rule: RULES.md S6. If Home can know before the click that an engine cannot take work, the control is disabled and one line says why.
An error is only for what Home could not know. Chat has worked this way since CHAT-PAUSE-01; pictures and video joined in
ENGINE-STATUS-MEDIA-01 (2026-10-29). Owner's ruling of 2026-10-29: `docs/design/status-surfaces-review-2026-10-29.md`.

## The three steps for a new role (music, speech to text, vision, ...)

1. **Health row.** Add the role to `HealthRole` in `backend/src/lib/roleHealth.ts` and read its state from the Stack, never from the
   wording of an error: `GET /stack/v1/roles` (`notInstalled`, `installed`, `loaded`, `ready`, `offline`), the memory watchdog in
   `GET /stack/v1/memory` (`watchdog.generation_paused`), coding mode, and a remembered refusal (`rememberMediaRefusal` /
   `stackRefusal` in `stackEngine.ts`, set where the call is made and cleared by the next accepted call). Return `availability`
   (`ready`, `starting`, `unavailable`) and a `cause` (`restarting`, `memory`, `not_installed`, `mode_change`, `offline`). Add the row
   to `collectHealth` in `healthSnapshot.ts`, `wire.ts` and the health schema in `app.ts` (additive, optional), then
   `cd backend && bun run gen:api-docs`. Share the Stack reads between rows so a health poll stays one round. A role that a computer
   may simply not have stays out of `ok` and the engine count.
2. **Copy.** Words live only in `backend/src/lib/failureCopy.ts`, in the `ComposerNotice` shape (adult, teen, child, `repairs_link`),
   chosen by `cause` (see `makingNotice`). No figures in a person-facing line: no sizes, no percentages. At the Stack call boundary,
   turn a refusal that is a known state into the household line (`plainMakingLine` in `lib/pictures/plainLine.ts`); `plainEngineLine`
   stays as the last net for any memory sentence with figures.
3. **Hook and controls.** Read the row with a hook on the same `["health"]` query (`useHealthQuery`), never a new query or timer
   (`frontend/src/apps/chat/useMakingAvailability.ts` is the model: `{ availability, reason, disabled }`, band from the signed-in
   person, child line when unknown). Every control that would start work passes `disabled` to the kit control as it ships (rule 9)
   with `aria-describedby` pointing at the line and `title` set to it.

## The prominence ladder (owner-approved 2026-10-29)

| Rung | When | How |
|---|---|---|
| Quiet | the state does not touch what the person is doing | the header pill and the Status page only |
| In place | what they are about to do cannot run | one line where they act (the screen's existing muted line, or the control's own hint in a card or menu) and the control greyed out |
| Interrupt | something they asked for was waiting and is now going | one dismissable kit toast, once, only while they are still on that screen (`useMakingRecovery`); with nothing waiting there is no message, the controls just turn normal |
| Admin | a person cannot fix it | Repairs and the bell; a media pause may become one admin row in the install dock (not built yet) |

Children get the same one line where they act, in their own words, and no header pill, as in chat.

## Checks

`backend/tests/makingHealth.test.ts` (each cause, refusal memory, no figures in any line or response),
`frontend/src/apps/chat/useMakingAvailability.test.tsx` (band lines, recovery toast once) and
`frontend/src/shell/pages/companionFlow/makingPaused.test.tsx` (one disabled control per screen). To see it by hand on a dev hub,
point `bun run dev` at a Stack whose `/stack/v1/memory` reports `generation_paused: true`; a real memory pause cannot be forced safely.
