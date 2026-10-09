// GENUI-03b: answer blocks in the chat thread. A package's validated block
// (spec AnswerBlock; the hub filtered it, GENUI-02) is one assistant-ui `data`
// part named `answer_block`, drawn by the kit's dispatcher as shipped (rule
// 9): the dispatcher picks the Element for the block's `kind`. Home only
// shapes the data, in tool-call order, the same on the live stream and on a
// reload, so nothing moves when the stored turn replaces the live one.
import type { DataMessagePartComponent, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { AnswerBlockView } from "@maipai/ui/src/elements/answer-block";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";

/** The data part's `name`. */
export const ANSWER_BLOCK_PART = "answer_block";

/** The blocks the kit can draw, in the order given, each once (a resumed
 * stream resends them). A record the spec refuses, an unknown `kind`
 * included, is dropped here: it never reaches the thread and never fails
 * the reply. */
export function drawableBlocks(blocks: readonly unknown[] | undefined): AnswerBlock[] {
  const seen = new Set<string>();
  const out: AnswerBlock[] = [];
  for (const raw of blocks ?? []) {
    const parsed = AnswerBlock.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out;
}

/** One `answer_block` data part per drawable block, in tool-call order. */
export function answerBlockParts(blocks: readonly unknown[] | undefined): ThreadAssistantMessagePart[] {
  return drawableBlocks(blocks).map((block) => ({ type: "data", name: ANSWER_BLOCK_PART, data: block }) as ThreadAssistantMessagePart);
}

/** The `answer_block` data part's renderer: the kit dispatcher, given the block. */
export const AnswerBlockDataRender: DataMessagePartComponent<AnswerBlock> = ({ data }) => <AnswerBlockView block={data} />;
