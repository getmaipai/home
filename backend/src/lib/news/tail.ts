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
const RELATED_MARKER = /^(?:related(?: (?:stories|articles|posts|coverage|reading|video|videos))?|(?:also|read) (?:read|also)|read more|you may also like|more like this|watch next|recommended(?: for you)?)\s*:?$/i;
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

/** One line of a "Related" box: a heading, a list, or a short line that is a headline (no closing punctuation), not a sentence of the story. */
function isLinkLine(block: ArticleBlock): boolean {
  if (block.type === "heading" || block.type === "list") return true;
  if (block.type !== "paragraph") return false;
  const text = textOf(block).replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length < 140 && text.split(" ").length <= 20 && !/[.!?”"')]\s*$/.test(text);
}

/** A paragraph that says exactly what the paragraph before it said (The Verge repeats its lede when the page carries both the standfirst and the body). */
function repeatsPrevious(blocks: readonly ArticleBlock[], i: number): boolean {
  const block = blocks[i]!;
  if (block.type !== "paragraph" || i === 0) return false;
  const text = textOf(block).replace(/\s+/g, " ").trim();
  const before = blocks[i - 1]!;
  return text.length >= 40 && before.type === "paragraph" && textOf(before).replace(/\s+/g, " ").trim() === text;
}

/** The story's own blocks: everything from the first tail marker on is dropped, and an embedded post quote is dropped anywhere.
 * A marker among the first three blocks is left alone (a short story may itself begin with such a word). A "Related" box with the
 * story still running after it (The Verge puts one mid-story) is dropped with its link list and the story goes on. */
export function trimArticleTail(blocks: readonly ArticleBlock[]): ArticleBlock[] {
  const kept = blocks.filter((block, i) => !(block.type === "quote" && EMBEDDED_POST.test(textOf(block))) && !repeatsPrevious(blocks, i));
  const out: ArticleBlock[] = kept.slice(0, Math.min(3, kept.length));
  for (let i = 3; i < kept.length; i++) {
    const text = textOf(kept[i]!).replace(/\s+/g, " ").trim();
    if (text && RELATED_MARKER.test(text) && storyResumesAfter(kept, i + 1)) {
      // The box's own links go with it: headline lines (headings, a list, a short line with no closing sentence) until prose resumes.
      let next = i + 1;
      while (next < kept.length && isLinkLine(kept[next]!)) next++;
      i = next - 1;
      continue;
    }
    if (text && (TAIL_MARKER.test(text) || (text.length < 200 && AFFILIATE.test(text)))) break;
    out.push(kept[i]!);
  }
  return out;
}
