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
