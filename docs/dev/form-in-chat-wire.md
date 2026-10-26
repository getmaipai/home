# Form in chat wire contract

`TurnValue.ask` is `{ turn_id, prompt, fields, expires_at }`. Each field follows
the generated `PluginResult.ask.fields` schema: `{ name, label, kind, required,
placeholder?, min?, max?, max_length?, options? }`. `kind` is `text`, `number`,
`date_time`, `choice`, or `yes_no`.

Submit through the existing `POST /api/turn` or `/api/turn/stream` request body:

```json
{"conversation_id":"...","text":"","ask_answer":{"turn_id":"...","values":{"field_name":"value"}}}
```

`values` maps field names to string, finite number, boolean, or null. The same
`ask_answer` member continues to accept confirm `{ turn_id, approved }` and
robot offer `{ offer_id, approved }` shapes. Successful submission consumes the
pending form and starts a new turn.

## Types and gates

The TypeScript shapes are `TurnAsk`, `TurnAskField` and `AskAnswerRequest` in
`backend/src/wire.ts`. Value checks are `validateAskValues` in
`backend/src/lib/askForm.ts`.

The hub draws the form only for an adult speaker on written chat in a saved
conversation. A child, a teen, an unknown speaker or a temporary conversation
gets the package's text prompt and no `ask`. The form is valid for 15 minutes.

`ask_answer.values` is checked against each field: required, `text` at most 500
characters, `number` within `min` and `max`, `choice` one of `options`,
`yes_no` a boolean, `date_time` a parseable date and time. A name that is not
a field is refused.

| Case | Response |
|---|---|
| Turn id, person, band, conversation or expiry does not match, or the answer shape does not fit the pending ask | `409 ask_stale` |
| A value fails its field | `400 invalid_input`, naming the field; the form stays open |
| Valid | The package runs again with the values merged into its arguments; the reply is a new turn |

The submit turn's user line is fixed wording; the client's `text` is ignored.
Values and the prompt are never logged, traced, stored in outcomes or sent on
the tool timeline. A package failure after a Submit reaches the model as a
failure kind only. A consequential package still parks its own confirm after a
Submit.
