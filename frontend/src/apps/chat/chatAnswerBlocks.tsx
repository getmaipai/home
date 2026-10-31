// GENUI-03b: answer blocks in the chat thread. A package's validated block
// (spec AnswerBlock; the hub filtered it, GENUI-02) is one assistant-ui `data`
// part named `answer_block`, drawn by the kit's dispatcher as shipped (rule
// 9): the dispatcher picks the Element for the block's `kind`. Home only
// shapes the data, the same on the live stream and on a reload, so nothing
// moves when the stored turn replaces the live one. GENUI-13c: a block sits
// where the hub placed it, at its `after_paragraph` (absent: after the whole
// reply); the message part order is the layout. GENUI-05: the picture gallery
// is an `image_gallery` block like any other (the separate `answer-images`
// data part, its renderer and its placer path are retired), so this file is the
// one place a visual is placed in the reply.
import { useContext } from "react";
import type { DataMessagePartComponent, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { ImageEditContext } from "@maipai/ui/src/elements/attachment.aui";
import { AnswerBlockView } from "@maipai/ui/src/elements/answer-block";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import { splitAfterParagraph } from "@maipai/spec/interpreters/ts/paragraphs.js";
import { useState } from "react";
import { request } from "@/lib/api";

/** The data part's `name`. */
export const ANSWER_BLOCK_PART = "answer_block";

// The paragraph count and split are the spec's one helper (the hub counts with the same code), not a copy kept here.
export { splitAfterParagraph };

/** A part and where it goes: after this many paragraphs of the reply text (0: before any text; past the end or
 * Infinity: after the whole reply). */
export type PlacedPart = { after: number; part: ThreadAssistantMessagePart };

/** The reply's text with the given parts placed in it, in the order given among equal positions: text, a part, text,
 * and so on, one text part per stretch of text between two parts (rule 9: the message part order is the layout;
 * nothing here positions anything). No parts: the text as one part. */
export function placeParts(text: string, placed: readonly PlacedPart[]): ThreadAssistantMessagePart[] {
  if (placed.length === 0) return [{ type: "text", text }];
  const cuts = placed
    .map((item, order) => ({ ...item, order, at: splitAfterParagraph(text, item.after)[0].length }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const parts: ThreadAssistantMessagePart[] = [];
  let from = 0;
  cuts.forEach((cut, i) => {
    const piece = text.slice(from, cut.at);
    if (piece.trim()) parts.push({ type: "text", text: i === 0 ? piece.trimEnd() : piece.trim() });
    parts.push(cut.part);
    from = cut.at;
  });
  const rest = text.slice(from);
  if (rest.trim()) parts.push({ type: "text", text: rest.trimStart() });
  return parts;
}

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
/** The reply's text with its answer blocks (a picture gallery included) placed in it, each at its own
 * `after_paragraph`, in the order given among equal positions: the order the hub placed them. No block: the text as
 * one part. A block with no `after_paragraph` (a record from before GENUI-13c) goes after the whole reply. */
export function textWithAnswerParts(text: string, visuals: { blocks?: readonly unknown[] | undefined }): ThreadAssistantMessagePart[] {
  const placed: PlacedPart[] = drawableBlocks(visuals.blocks).map((block) => ({
    after: block.after_paragraph ?? Number.POSITIVE_INFINITY,
    part: { type: "data", name: ANSWER_BLOCK_PART, data: block } as ThreadAssistantMessagePart,
  }));
  return placeParts(text, placed);
}

/** The `answer_block` data part's renderer: the kit dispatcher, given the block. The placement stamp is the thread's
 * business (it decided where this part sits), and the kit's own copy of the strict block schema may be pinned before
 * that field existed, so the kit is handed the block without it: otherwise it would draw the `alt` fallback. */
export const AnswerBlockDataRender: DataMessagePartComponent<AnswerBlock> = ({ data }) => {
  const [undoAvailable, setUndoAvailable] = useState(data.kind === "confirmation" && Boolean(data.props.undo));
  const block: Record<string, unknown> = { ...data };
  delete block.after_paragraph;
  // IMGTOOLS-05: a picture gallery shows the kit's Edit button only when every picture in it is one the person
  // may edit (a stored attachment or a saved edit); a web picture an answer shows carries its own licence and is
  // not theirs to alter, so such a gallery gets no handler at all.
  const edit = useContext(ImageEditContext);
  const images = data.kind === "image_gallery" && Array.isArray((data.props as { images?: unknown }).images) ? ((data.props as { images: Array<{ id?: string; src?: string; alt?: string }> }).images) : [];
  const targets = images.map((image) => ({ id: String(image.id ?? ""), name: String(image.alt ?? "picture"), src: String(image.src ?? "") }));
  const editable = edit !== null && targets.length > 0 && targets.every((target) => target.id !== "" && (edit.canEdit ? edit.canEdit(target) : true));
  const onImageEdit = editable ? (_blockId: string, imageId: string) => { const target = targets.find((candidate) => candidate.id === imageId); if (target) edit.onEdit(target); } : undefined;
  const onAction = data.kind === "confirmation" && undoAvailable
    ? async (id: string, action: string) => {
        if (action !== "undo") return;
        await request(`/api/tool-undo/${encodeURIComponent(id)}`, { method: "POST" });
        setUndoAvailable(false);
      }
    : undefined;
  let renderedBlock = block;
  if (data.kind === "confirmation" && !undoAvailable) {
    const props = { ...(block.props as Record<string, unknown>) };
    delete props.undo;
    renderedBlock = { ...block, props };
  }
  return (
    <AnswerBlockView
      block={renderedBlock}
      {...(onImageEdit ? { onImageEdit } : {})}
      {...(onAction ? { onAction } : {})}
    />
  );
};
