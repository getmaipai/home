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

/** The data part's name on both wires (backend assistantStreamWire.ts). */
export const ANSWER_IMAGES_PART = "answer-images";
/** Tiles in the row; the rest open from the badge. */
export const ANSWER_IMAGES_VISIBLE = 3;
const HUB_IMAGE = /^\/api\/answer-image\/ai_[a-f0-9]{32}\?v=(tile|full)$/;

const PARAGRAPH_BREAK = /\n[ \t]*\n\s*/g;

/** Splits `text` after its `n`th paragraph (0: before any text), the same
 * count the hub placed the set at; a count past the end puts it last. */
export function splitAfterParagraph(text: string, n: number): [string, string] {
  if (n <= 0) return ["", text];
  let seen = 0;
  for (const match of text.matchAll(PARAGRAPH_BREAK)) {
    const end = (match.index ?? 0) + match[0].length;
    seen = text.slice(0, match.index).split(/\n[ \t]*\n\s*/).filter((p) => p.trim().length > 0).length;
    if (seen >= n) return [text.slice(0, end), text.slice(end)];
  }
  return [text, ""];
}

/** The reply's text with the picture set placed in it: one text part, or
 * text before, the `answer-images` data part, and text after. */
export function textWithAnswerImages(text: string, set: AnswerImageSet | undefined, id: string): ThreadAssistantMessagePart[] {
  if (!set || set.items.length === 0) return [{ type: "text", text }];
  const [before, after] = splitAfterParagraph(text, set.after_paragraph);
  const parts: ThreadAssistantMessagePart[] = [];
  if (before.trim()) parts.push({ type: "text", text: before.trimEnd() });
  parts.push({ type: "data", name: ANSWER_IMAGES_PART, data: { ...set, id } } as ThreadAssistantMessagePart);
  if (after.trim()) parts.push({ type: "text", text: after.trimStart() });
  return parts;
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
