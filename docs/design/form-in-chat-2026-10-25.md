# Forms in chat (2026-10-25)

Rows covered: PKG-ASK-01, PKG-RESULT-01, FORM-CHAT-SPEC-01, FORM-CHAT-UI-01, FORM-CHAT-HUB-01, FORM-CHAT-WEB-01, FORM-CHAT-ROBOT-01.

Design note only. No schema or code change is made here.

## Purpose and audience

When a package needs a small missing value, its `ask` result can pause the package action and show the person a typed form. After submission, the same package flow continues and the assistant completes the reply. For example, when Sage asks to be reminded to call the dentist but gives no time, the reminder package can ask for that time. The form collects package arguments. It is not an approval control or a settings editor.

This note is for the commons spec and UI maintainers, Home backend and frontend maintainers, and the robot maintainers.

## What exists today

- `PluginResult.ask` in `spec/schemas/result.schema.json` already has `prompt` and `expects`. `spec/interpreters/ts/recipe-interpreter.ts` implements the recipe `ask` op, and `spec/fixtures/recipes/ask-disambiguate.json` proves it. Home already parks `PendingAsk` with `kind: "ask"`, `packageId`, `args`, `expects` and `turnId` in `conversationHistory.ts`; `turnNext.ts` persists it. APPROVE-CARD-01 provides structured `ask_answer {turn_id, approved}` for confirm cards, draws `TurnValue.confirm` as a `ToolCallMessagePart`, and returns `409 ask_stale` for a stale tap. This design adds field-value submission and package rerun to that existing path.
- Answer blocks are validated and filtered in `backend/src/lib/answerBlocks.ts`, streamed by `backend/src/lib/turnMachine/blockEvents.ts`, and drawn by `frontend/src/apps/chat/chatAnswerBlocks.tsx` through the kit dispatcher.
- The shipped `elicitation-form` Element has text, choice and toggle fields plus request, accepted and declined states. It is not wired as a general package-argument form. Its existing fields are static spans, not real input controls.
- `question-flow` and `option-list` are shipped Elements. The answer-block `choice` work in `docs/design/chat-cards-2026-10-18.md` covers one-tap conversational choices; this proposal uses the Elements only to draw typed `ask` fields.
- `backend/src/lib/failureCopy.ts` provides person-facing failure copy. Raw errors never appear in the form Alert or reach the model.
- Rules 0, 1, 6, 6a, 9, 9b and S6 govern this proposal. The initial implementation is adult-only.

## Reuse check

1. **`PluginResult.ask` plus recipe `ask` op: use this, additively.** `ask` already means a package needs a deterministic follow-up, and the interpreter plus fixture establish the producer contract. Extend its closed schema additively with typed `fields`; do not define another meaning for “a package asks the person for a value.” The answer-block `form` kind is dropped. A typed `ask` carrying fields is rendered by the shipped elicitation-form Element. An `ask` without fields remains a text question answered in chat.
2. **assistant-ui `addToolResult` / `resumeToolCall` and `requires-action`: retain the current tool-call part path.** In pinned `@assistant-ui/core` 0.3.20, `addToolResult` and `resumeToolCall` accept tool-call parts and their tool-call IDs; `requires-action` is a status. The web already uses assistant-ui's tool-call part for confirm. Adding field values to this path replaces nothing assistant-ui ships. The package ask is persisted by Home and its response is routed through the authenticated turn path.
3. **`question-flow` and `option-list`: reuse for `choice` and `yes_no` fields.** They already draw fixed options and binary choices. The `elicitation-form` Element owns the form structure and other field controls; it may compose those shipped Elements for these two field types, with no Home wrapper or visual override.

## Ask contract and rendering

Extend `PluginResult.ask` with an optional, typed `fields` array. Keep `prompt` and `expects` as the existing fields. A field has a stable name, label, kind, required flag, optional placeholder and kind-specific constraints. Initial kinds are:

- `text`: at most 500 Unicode characters.
- `number`: finite value with optional package-declared minimum and maximum.
- `date_time`: one local date and time; the package owns timezone interpretation and confirms the interpreted time in its result.
- `choice`: one of 2 to 8 fixed labels.
- `yes_no`: explicit yes or no as ordinary data, never consent.

One ask has at most 4 fields. Labels and choice labels are at most 80 characters, prompt at most 300. No multi-select, free-form option creation, files, secrets, person/entity picker or nested form. The implementation must preserve compatibility with existing `ask` values that have no `fields`.

The answer-block `form` kind is dropped. Rendering is the `elicitation-form` Element drawing a `PluginResult.ask` that carries fields, not a second answer-block contract. The Element's fields become real kit inputs; today every field is a static span. Home supplies validated data and callbacks only. It must not wrap or restyle the Element.

## Pause and resume

The recipe `ask_step` is always its last step. No recipe checkpoint is needed: after submission, Home runs the package again with the submitted values bound to the recipe's `expects` or declared `fields` inputs.

`getPendingAsk` and `setPendingAsk` in `backend/src/lib/conversationHistory.ts` already persist pending asks by conversation. The existing `PendingAsk` supports `kind: "ask"`, `packageId`, `args`, `expects` and `turnId`. Extend the persisted ask with `fields`, band, actor binding and expiry. These helpers do nothing for a temporary conversation, and `turnNext.ts` draws no confirm card there. A temporary or ephemeral conversation gets only the text prompt, with no form; Submit is never a guaranteed `ask_stale`. `turnNext.ts` releases the request's `TurnLease` when the request ends, as it does today. Resume takes a new request lease, reruns the package with submitted values bound as inputs, and passes the same policy and consent checks as a model call. A consequential package still parks its own confirm afterwards.

Only clicking Submit sends values. The hub validates ask identity, package ownership, actor, band, conversation and values. An expired or mismatched submission returns the existing `409 ask_stale`, shown in the form's destructive Alert with `failureCopy.ts` copy. A submit, validation or route failure also goes to that form Alert with `failureCopy.ts` copy (S6). A package failure after resume goes to the model, which answers in its own words after being told only the kind of failure; the admin raw-error indicator works as today. No fixed or stored wording is used for that reply. Raw error details never reach a non-admin or the model.

Store turns the way confirm does: the ask turn is completed with its released text, and the resumed reply is a new turn. Do not join replies across requests. The model receives only the validated answer and package result needed to finish the resumed reply; it receives no route or callback authority.

Submitted values, the prompt and typed chat text are never logged, traced, included in status/admin pages or attached to activity metrics. Logs may record typed event names, package/component health, error kinds, timings and aggregate counts without a person or record identifier, per rule 6a.

## Gates and surfaces

### Age, speaker and surface

`min_band` is required only when `fields` is present. The ask minimum is the highest minimum of its fields. The first implementation declares the ask adult-only until child and teen wording, package behavior and output-floor fixtures have been reviewed. The hub validates the band before drawing and again at submit. Unknown speakers are evaluated at the child band and cannot access another person's memories or signed-in account effects. If speaker evidence is absent, do not submit. A child or teen may submit only a package action independently allowed for that band; settings mutation is never permitted for a minor.

### Voice, robot and malformed data

Voice does not collect values through inferred spoken confirmation. The assistant speaks a short line asking the person to continue in written chat, where they can review and submit. The robot has no screen: it speaks a short line that the value is needed in chat, stores no form response, and cannot submit. A malformed, unsafe, unknown or out-of-band ask is dropped while the answer remains complete. A client that cannot render the ask uses its text prompt as fallback.

Invalid field values stay in the form with a field-level message naming the problem and next step. A route failure is shown through the kit destructive Alert inside the form, with copy from `lib/failureCopy.ts`; it is never the raw error. Do not add a banner or toast.

### What the form must not do

- It never contains consent controls or copy and never approves a parked confirmation. Consent stays deterministic.
- It never changes settings, package enablement, access, privacy or household controls. Chat settings editing is outside this design.
- It never adds a banner, dot, panel, toast, polling loop or new status surface. System state and action failures use existing S6 mechanisms.
- It never executes before a click, submits a model-authored route, logs values or carries arbitrary code.

## Slice plan

The rows below implement or replace PKG-ASK-01 and PKG-RESULT-01; they are the single row set for this capability. Acceptance commands run from the named repository root.

| ID | Implements or replaces | Size | Repo | Objective and acceptance command |
|---|---|---|---|---|
| FORM-CHAT-SPEC-01 | PKG-ASK-01 and the `ask` part of PKG-RESULT-01 | M | commons spec | Extend `PluginResult.ask` additively with typed `fields`; extend recipe `ask_step` with the same optional `fields`, retain the last-step contract, add a conformance fixture beside `ask-disambiguate.json`, and update generated types. The TypeScript and Python twins, including `spec/interpreters/py/recipe_interpreter.py`, must stay behaviorally identical. Name the fixture in both `spec/tests/ts/recipe-conformance.test.ts` and `spec/tests/py/test_recipe_conformance.py`, which run every fixture in `spec/fixtures/recipes/`. `min_band` is required only when `fields` is present. PKG-RESULT-01's `confirm` and `end_conversation` parts stay open. Acceptance: `bash scripts/check.sh --pre` from commons, `bun test` from commons `spec/`, and `uv run pytest tests/py/test_recipe_conformance.py -q` from commons `spec/`. |
| FORM-CHAT-UI-01 | PKG-ASK-01 | M | commons ui | Make elicitation-form's fields real kit inputs for all five kinds, including submit/error states; use `question-flow` and `option-list` for choice and yes/no. The UI-DECISIONS row is a precondition before any line is written. For date and time, use the kit `Input` (`type="time"` / `datetime-local`) and the kit's existing `Calendar` (`ui/src/dashboard/components/ui/calendar.tsx`, react-day-picker as pinned in `ui/package.json`) in `mode="single"`; only if those cannot do it, check Kibo UI, then anything else needs a UI-DECISIONS row first. No new date dependency, no second copy of a part. The commons change lands first under rule 9c; a new kit tag needs Jesse's yes. Acceptance: the UI-DECISIONS precondition is met, and `bun test` from commons `ui/`. |
| FORM-CHAT-HUB-01 | PKG-ASK-01 and the `ask` part of PKG-RESULT-01 | L | home backend | Validate, persist, expire and resume package asks; implement pause semantics above; keep submitted values out of `state.outcomes` and the trace, unlike confirm's `outcomeOf` args at `turnNext.ts` around line 773, as required by rule 6a. Temporary and ephemeral conversations get only the text prompt because `getPendingAsk` / `setPendingAsk` in `backend/src/lib/conversationHistory.ts` do nothing there and `backend/src/lib/turnMachine/turnNext.ts` draws no confirm card there; therefore Submit is never a guaranteed `ask_stale`. Acceptance: `bash scripts/check.sh --pre` from Home. |
| FORM-CHAT-WEB-01 | PKG-ASK-01 | M | home frontend | Add `TurnValue.ask` in `wire.ts` and draw it as a `ToolCallMessagePart`; render `elicitation-form` through a named function registered in `elementBindings.ts` `TOOL_BINDINGS` that returns only the Element; submit through additive `ask_answer {turn_id, values}`; unknown asks retain text fallback. Acceptance: `bun run lint:ui-rules` from Home frontend. |
| FORM-CHAT-ROBOT-01 | PKG-ASK-01 | S | robot | Speak the ask prompt, never collect or submit values, and direct the person to written chat. Acceptance: `bash scripts/check.sh --pre` from bot. |

Implementation order is spec, commons UI, Home hub, Home web, then robot. Robot remains fallback-only and cannot submit.

## Open questions

1. Should child forms ship in the first release? Recommended: no; keep the ask adult-only until package-specific wording and action are reviewed.
2. Should teen forms ship in the first release? Recommended: no; add teen eligibility only after package-specific review and fixtures.
3. May a submitted value be retained in a conversation transcript after completion? Recommended: no extra transcript copy; keep it only for the active turn and the package's intended record.
4. Should adults edit settings from chat forms later? Recommended: no; use the existing settings editor and authorization paths.
5. Should shared screens show adult-only asks? Recommended: no; require reliable speaker evidence and drop person-scoped asks when the speaker is unknown.

## Supersedes

This note proposes changing the `elicitation-form`, `question-flow` and `option-list` verdicts recorded in `frontend/src/dev/elements-plan.json`; that file is the editable source, and `frontend/src/dev/elements-adoption.json` is generated and must be regenerated after the plan changes. It also replaces the UI open question in PKG-ASK-01 and the `ask` shapes in `result.schema.json` and recipe `ask_step` only by additive extension with typed `fields`. It does not replace the existing page `form` node.
