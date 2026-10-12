# Sensitive subjects for children and teens (MINOR-TOPICS-01)

How the hub tells the model to handle bodies, health, feelings, risk, violence, people and beliefs for a child or teen.
Design record: `data-scratch/design/MINOR-TOPICS-01.md` (private). Spec: `spec/safety/topic-copy.json` in `commons`.

## The block (01c)

- `backend/src/lib/topicPrompt.ts` builds one block per turn from the band's record and the person's keys
  (`topicStances.ts`, 01b). `turnNext` computes it once and keeps it on `TurnState.topicBlock`.
- `buildStablePrefix(persona, surfaceClass, topicBlock)` appends it after the persona sections, separated by a
  blank line. An adult passes "" and the prefix is byte-identical (a hash test pins this).
- `contextToMessages` takes the block as its last argument, so the context window sizes itself on the real prompt
  and the block's tokens are reserved before history is cut.
- A child's own keys apply only when the speaker really is that child. A robot turn that heard a child on an adult's
  session, or a teen, gets the band defaults (teens follow the household keys only).
- Calls that are not chat turns carry the block as a first system message: package `llm.complete`, `POST /api/llm`
  and project text steps (`topicSystemMessages`, `topicSystemMessagesForId`). A missing person reads as a child.
- The old lone line "Keep it simple and kind, for a child." in `composer.ts` is gone; the header of the block says it.

## Call-site inventory (architect condition 4)

`backend/tests/topicPrompt.test.ts` lists every source file that imports a model-call function from `lib/llm`.
Each is either in `CARRIES` (and the test checks it uses the block) or in `EXEMPT` with a reason. A new call site
fails the test until it is classified.

## Token budget

The bar is at most 260 tokens at the child and teen defaults (design section 8). Measured 2026-10-12 with the
Qwen3.8 9B tokenizer: spec-v0.1.122 wording gave 328 (child, with the three story names) and 265 (teen), so
spec-v0.1.123 shortened the sentences without changing instructions: child 256, teen 258. Unit tests hold a character
floor (child 1,000, teen 1,100); the live bench (01g) re-measures with the default model's tokenizer. The longest
reachable block (every adjustable family on its longest stance, ten 40-character story names) is bounded at 2,000
characters for a child and 1,250 for a teen.

## Crisis path (MINOR-TOPICS-01d)

Nothing here weakens the self-harm path. `detectSelfHarm`, the crisis overlay and the text-free parent alert take no topic input, and the fixed `feelings` support stance and `people` protect stance are in every rendered block.

- `crisisSupportFor(resources, band, region)` in `backend/src/lib/failureCopy.ts` builds the support block a client draws. For a child the text opens with `CHILD_CRISIS_LINE` ("Tell a grown-up you trust right now.") and, for a known region, one child-abuse help line is added to the links (`CHILD_HELP_LINES`, US: Childhelp). The wire field `crisis_resources` and the 988 text are the same for every band. A teen's and an adult's block is unchanged.
- The turn result, the streamed safety refusal and the conversation history rebuild all pass the speaker's band, so a reloaded conversation shows the same block the live reply did for the person reading it (a child reloading sees the child line; a parent reading it sees the adult block, as with links).
- `backend/tests/topicCrisis.test.ts` renders the block for every reachable combination of a band's settings (child 16, teen 4, each with and without story names) and asserts the support sentence, 988, the emergency number, the people line and the hard lines; a stale or tampered setting still yields the full block; self-harm stays `allow_with_resources` for both bands on input and output; the support block shape per band.

## Settings surface (MINOR-TOPICS-01e)

- A child's levels (`topics.*`, group `person.topics`) show on the child's `PersonProfilePage` in a Topics tab, drawn by `SettingsRenderer` with `only=["person.topics"]` (the same pattern as the Limits tab; the spec lists the group under `not_placed` for this reason). The tab shows for an owner or admin viewing a child, never on the child's own page. Select options use the key's `copy.option_labels` (plain words) instead of title-cased option ids.
- The two teen rows (`topics.teen.bodies`, `topics.teen.risk`) are the `household.topics` card the spec already places under Settings, Privacy.
- `assertCanSetChildTopic` in `backend/src/lib/settings.ts` guards `setValue` and `resetValue` for any person-scope `topics.*` key: the target must be a child and the actor an owner or admin. A child cannot change their own keys; no admin path writes a teen's own keys (condition 5); the fixed families have no key, so a write is an unknown-key 400. `backend/tests/topicSettingsAccess.test.ts` covers each.
