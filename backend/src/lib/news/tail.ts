// NEWS-TAIL-01: a publisher's page carries more after the story: comment counts, "Guides" and "Apps" link lists, affiliate lines, a
// product strip, an embedded post. The reader cuts the article at the first such marker, once the story itself has begun.
import type { ArticleBlock } from "@/lib/retrieval/extractArticle";

const inlineText = (inlines: readonly { text: string }[]): string => inlines.map((inline) => inline.text).join("");
const textOf = (block: ArticleBlock): string => {
  switch (block.type) {
    case "paragraph":
    case "quote": return inlineText(block.inlines);
    case "heading":
    case "note": return block.text;
    default: return "";
  }
};

const TAIL_MARKER = /^(?:comments?(?: \(\d+\))?|leave a (?:reply|comment)|guides?|apps?|mac|iphone|ipad|related(?: (?:stories|articles|posts|coverage))?|more (?:stories|from|on|in)\b.*|most (?:popular|read)|read more|you may also like|recommended(?: for you)?|trending|popular|newsletter|subscribe\b.*|sign up\b.*|share this(?: story| article)?|do more with\b.*|check out .{1,60} (?:on youtube|for more).*|ftc:.*|(?:this )?(?:post|article) (?:may contain|contains) affiliate.*|advertisement|sponsored(?: content)?|tags?|filed under\b.*|about the author\b.*|follow us\b.*|more like this)\s*:?$/i;
const RELATED_MARKER = /^related(?: (?:stories|articles|posts|coverage))?\s*:?$/i;
const PROSE_CHARS = 80;
const AFFILIATE = /\b(?:affiliate links?|earn(?:s|ing)? (?:a |an )?(?:commission|income))\b/i;
const EMBEDDED_POST = /pic\.(?:twitter|x)\.com|^\s*(?:@\w+|—\s*\w.*\(@\w+\))/i;

/** True when two or more real paragraphs follow `from` before the next marker that is not a "Related" one: the box sits inside the story. */
function storyResumesAfter(kept: readonly ArticleBlock[], from: number): boolean {
  let prose = 0;
  for (let i = from; i < kept.length; i++) {
    const text = textOf(kept[i]!).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (TAIL_MARKER.test(text) && !RELATED_MARKER.test(text)) return prose >= 2;
    if (kept[i]!.type === "paragraph" && text.length >= PROSE_CHARS) prose++;
  }
  return prose >= 2;
}

/** The story's own blocks: everything from the first tail marker on is dropped, and an embedded post quote is dropped anywhere.
 * A marker among the first three blocks is left alone (a short story may itself begin with such a word). A "Related" box with the
 * story still running after it (The Verge puts one mid-story) is dropped with its link list and the story goes on. */
export function trimArticleTail(blocks: readonly ArticleBlock[]): ArticleBlock[] {
  const kept = blocks.filter((block) => !(block.type === "quote" && EMBEDDED_POST.test(textOf(block))));
  const out: ArticleBlock[] = kept.slice(0, Math.min(3, kept.length));
  for (let i = 3; i < kept.length; i++) {
    const text = textOf(kept[i]!).replace(/\s+/g, " ").trim();
    if (text && RELATED_MARKER.test(text) && storyResumesAfter(kept, i + 1)) {
      if (kept[i + 1]?.type === "list") i++;
      continue;
    }
    if (text && (TAIL_MARKER.test(text) || (text.length < 200 && AFFILIATE.test(text)))) break;
    out.push(kept[i]!);
  }
  return out;
}
