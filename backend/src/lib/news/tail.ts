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

const TAIL_MARKER = /^(?:comments?(?: \(\d+\))?|leave a (?:reply|comment)|guides?|apps?|mac|iphone|ipad|related(?: (?:stories|articles|posts|coverage))?|more (?:stories|from|on)\b.*|read more|you may also like|recommended(?: for you)?|trending|popular|newsletter|subscribe\b.*|sign up\b.*|share this(?: story| article)?|do more with\b.*|check out .{1,60} (?:on youtube|for more).*|ftc:.*|(?:this )?(?:post|article) (?:may contain|contains) affiliate.*|advertisement|sponsored(?: content)?|tags?|filed under\b.*|about the author\b.*|follow us\b.*|more like this)\s*:?$/i;
const AFFILIATE = /\b(?:affiliate links?|earn(?:s|ing)? (?:a |an )?(?:commission|income))\b/i;
const EMBEDDED_POST = /pic\.(?:twitter|x)\.com|^\s*(?:@\w+|—\s*\w.*\(@\w+\))/i;

/** The story's own blocks: everything from the first tail marker on is dropped, and an embedded post quote is dropped anywhere.
 * A marker among the first three blocks is left alone (a short story may itself begin with such a word). */
export function trimArticleTail(blocks: readonly ArticleBlock[]): ArticleBlock[] {
  const kept = blocks.filter((block) => !(block.type === "quote" && EMBEDDED_POST.test(textOf(block))));
  let cut = kept.length;
  for (let i = 3; i < kept.length; i++) {
    const text = textOf(kept[i]!).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (TAIL_MARKER.test(text) || (text.length < 200 && AFFILIATE.test(text))) { cut = i; break; }
  }
  return kept.slice(0, cut);
}
