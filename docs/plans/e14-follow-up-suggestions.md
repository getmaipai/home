# E14 follow-up suggestions

## Supersedes

This note supersedes the earlier CHAT-FOLLOWUPS-01 / ELEMENTS-ADOPT-02 planning language wherever it treats follow-up suggestions as a synchronous part of turn completion or as a generic package-example suggestion. This slice uses only the visible, completed user and assistant messages for the just-finished turn; suggestion work starts after the answer has been released and cannot hold the turn open.

## Scope

Wire the shipped `follow-up-suggestions.aui.tsx` Element with model-written prompts for the most recent completed, ordinary written chat turn. Generation uses `completeBackground` and only the current user utterance and released assistant reply. It never reads earlier conversation messages, memory, profile, search results, tool arguments or tool results. It returns a small list of short follow-up prompts; malformed or unavailable output means no suggestions.

The backend enforces the gate: only an authenticated adult's non-temporary, non-ephemeral web chat turn can request suggestions. Child and teen requests return no suggestions; Incognito has no persisted turn and the UI also suppresses requests for temporary threads. Suggestions are not stored. A failed suggestion call cannot fail or revise the answer.

The UI supplies these results through assistant-ui's existing `SuggestionAdapter` and renders them only through the shipped Thread follow-up Element. Existing empty-thread starter suggestions remain unchanged. No assistant-ui or Commons record shape changes are needed.

## Design

After a completed ordinary turn is logged, expose an authenticated endpoint keyed by the completed turn id. It validates turn ownership and adult age band, rejects non-chat and ineligible statuses, then reads only that turn's user utterance and released reply. The background engine creates up to three short, non-duplicative follow-up questions. The endpoint returns `{ suggestions: [{ prompt }] }`; failures return an empty list. It does not persist prompt text or log user content.

The chat suggestion adapter invokes this endpoint only for the final assistant message in a non-temporary thread, using the assistant-ui message metadata that already identifies its persisted turn. It converts returned prompts to the adapter's `Suggestion` shape. The shipped Thread owns visibility, interaction and presentation. No Home wrapper, custom component, class override or CSS is added.

## Acceptance

- Backend tests prove child, teen, temporary/Incognito, foreign turn, failed turn, and non-chat turns receive no suggestions; adult eligible turns call the background engine with exactly the current user and released assistant text; malformed output and engine failure yield none.
- Frontend tests prove suggestions are requested only for the final persisted assistant turn, no call is made for temporary threads, and returned prompts are mapped to the existing adapter shape; empty-thread starter suggestions are unchanged.
- The app uses the shipped follow-up-suggestions Element with no wrapper or style override.
- Capture and open desktop 1440px and mobile 390px views, light and dark themes.
- Run one `bash scripts/check.sh`, self-review at medium effort, land the change and report scope and gate exit code.
