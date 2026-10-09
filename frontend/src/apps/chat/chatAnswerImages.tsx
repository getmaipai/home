// ANSWER-IMG-04: pictures in a chat answer (design: data-scratch/research/
// chat-images-in-answers.md sections 5, 7 and 8). The hub's `answer-images`
// set is one assistant-ui `data` part placed between the text before and
// after its paragraph boundary (`after_paragraph`), rendered by the kit's
// image-gallery Element as shipped (rule 9): a row of up to three square
// tiles, a `+N` badge tile, and its lightbox. Home only shapes the data:
// which pictures (hub-served, still painting), and the badge rule.
import { useCallback, useState, type SyntheticEvent } from "react";
import type { DataMessagePartComponent, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { ImageGallery, type GalleryImage } from "@maipai/ui/src/elements/image-gallery";
import type { AnswerImageSet } from "@maipai/home-backend/src/wire";
import { splitAfterParagraph } from "@maipai/spec/interpreters/ts/paragraphs.js";

/** The data part's name on both wires (backend assistantStreamWire.ts). */
export const ANSWER_IMAGES_PART = "answer-images";
/** Tiles in the row; the rest open from the badge. */
export const ANSWER_IMAGES_VISIBLE = 3;
const HUB_IMAGE = /^\/api\/answer-image\/ai_[a-f0-9]{32}\?v=(tile|full)$/;

// GENUI-13c: the paragraph count and split are the spec's one helper (the hub counts with the same code), not a copy
// kept here. Re-exported because the picture tests and callers have always imported it from this file.
export { splitAfterParagraph };

/** A part and where it goes: after this many paragraphs of the reply text (0: before any text; past the end or
 * Infinity: after the whole reply). */
export type PlacedPart = { after: number; part: ThreadAssistantMessagePart };

/** The reply's text with the given parts placed in it, in the order given among equal positions: text, a part, text,
 * and so on, one text part per stretch of text between two parts. The same cut for a picture set and an answer block
 * (rule 9: the message part order is the layout; nothing here positions anything). No parts: the text as one part. */
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

/** The picture set as its data part, with the id the renderer is keyed on. */
export const answerImagesPart = (set: AnswerImageSet, id: string): ThreadAssistantMessagePart =>
  ({ type: "data", name: ANSWER_IMAGES_PART, data: { ...set, id } }) as ThreadAssistantMessagePart;

/** The reply's text with the picture set placed in it: one text part, or
 * text before, the `answer-images` data part, and text after. */
export function textWithAnswerImages(text: string, set: AnswerImageSet | undefined, id: string): ThreadAssistantMessagePart[] {
  if (!set || set.items.length === 0) return [{ type: "text", text }];
  return placeParts(text, [{ after: set.after_paragraph, part: answerImagesPart(set, id) }]);
}

/** What the gallery is given: hub-served pictures only, minus any that
 * failed to paint, with the badge rule kept (a lone extra is dropped, so
 * the badge never reads +1 and always equals what the gallery holds). */
export function galleryImages(set: AnswerImageSet, failed: ReadonlySet<string>): GalleryImage[] {
  const usable = set.items.filter((item) => HUB_IMAGE.test(item.src) && !failed.has(item.id));
  const visible = Math.min(set.visible, ANSWER_IMAGES_VISIBLE);
  const shown = usable.length > visible && usable.length - visible < 2 ? usable.slice(0, visible) : usable;
  return shown.map((item) => ({
    id: item.id,
    src: item.src,
    alt: item.alt,
    caption: item.license ? `${item.caption} · ${item.license.short}${item.license.artist ? `, ${item.license.artist}` : ""}` : item.caption,
    source: { label: item.source.site, url: item.source.url },
  }));
}

/** The `answer-images` data part's renderer: the kit gallery as shipped. A
 * tile whose picture fails to paint (an evicted cache entry the hub could
 * not refetch) is taken out of the set, so no broken tile is ever shown
 * and the badge updates; nothing is left when none paint. */
export const AnswerImagesDataRender: DataMessagePartComponent<AnswerImageSet & { id?: string }> = ({ data }) => {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const onErrorCapture = useCallback((event: SyntheticEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const src = target.getAttribute("src");
    const item = data.items.find((i: AnswerImageSet["items"][number]) => i.src === src);
    if (item) setFailed((current) => (current.has(item.id) ? current : new Set(current).add(item.id)));
  }, [data.items]);
  const images = galleryImages(data, failed);
  if (images.length === 0) return null;
  return (
    <div data-slot="answer-images" className="py-2" onErrorCapture={onErrorCapture}>
      <ImageGallery images={images} maxVisible={Math.min(data.visible, ANSWER_IMAGES_VISIBLE)} aria-label="Pictures in this answer" />
    </div>
  );
};
