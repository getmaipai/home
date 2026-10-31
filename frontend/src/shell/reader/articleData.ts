import type { ArticleBlockData, ArticleInlineData, ArticleViewData } from "@maipai/ui/src/primitives/ArticleView";
import type { ReferenceArticleView, ReferenceBlock, ReferenceInline } from "@/lib/api";

// READER-03: the one place the Reference API's article becomes the kit reader's data (the hand-drawn pieces are gone, rule 12).
// A link without a book target is plain text; headings are clamped to the view's 2 to 4; figures keep an empty caption.
function asInline(value: ReferenceInline): ArticleInlineData {
  if (typeof value === "string") return { type: "text", text: value };
  if (value.type === "link") return value.book && value.path ? { type: "link", text: value.text, target: { book: value.book, path: value.path } } : { type: "text", text: value.text };
  return value;
}

export function asBlock(block: ReferenceBlock): ArticleBlockData {
  switch (block.type) {
    case "heading": return { ...block, level: Math.min(4, Math.max(2, block.level)) as 2 | 3 | 4 };
    case "paragraph": return { type: "paragraph", inlines: block.inlines.map(asInline) };
    case "list": return { type: "list", ordered: block.ordered, items: block.items.map((item) => item.map(asInline)) };
    case "figure": return { ...block, caption: block.caption ?? "" };
    case "rows":
    case "table":
    case "note": return block;
  }
}

/** The lead sentence is drawn as the standfirst, so it is cut from the start of the first paragraph (once, only when it is really the start). */
function withoutLead(blocks: ArticleBlockData[], lead: string | undefined): ArticleBlockData[] {
  if (!lead) return blocks;
  const at = blocks.findIndex((block) => block.type === "paragraph");
  const first = blocks[at];
  if (!first || first.type !== "paragraph") return blocks;
  const text = first.inlines.map((inline) => inline.text).join("");
  if (!text.startsWith(lead)) return blocks;
  let cut = lead.length;
  while (text[cut] === " ") cut++;
  const inlines: ArticleInlineData[] = [];
  let seen = 0;
  for (const inline of first.inlines) {
    const end = seen + inline.text.length;
    if (end > cut) inlines.push({ ...inline, text: inline.text.slice(Math.max(0, cut - seen)) });
    seen = end;
  }
  return inlines.length ? [...blocks.slice(0, at), { ...first, inlines }, ...blocks.slice(at + 1)] : [...blocks.slice(0, at), ...blocks.slice(at + 1)];
}

export interface ArticleDataOptions {
  /** The app's own name, the first breadcrumb item (S2: never the global Home). */
  appName: string;
  onAppHome: () => void;
  /** Opens a search for the category the article sits in, so the category crumb is a link. */
  onCategory?: (category: string) => void;
}

/** A page with no lead picture of its own (no infobox photo) opens with its first figure as the hero, the way the mockup does. */
function firstFigureHero(blocks: ReferenceBlock[]): { hero: { src: string; alt: string; caption: string }; rest: ReferenceBlock[] } | null {
  const at = blocks.findIndex((block) => block.type === "figure");
  const figure = blocks[at];
  if (!figure || figure.type !== "figure") return null;
  return { hero: { src: figure.src, alt: figure.alt, caption: figure.caption ?? "" }, rest: [...blocks.slice(0, at), ...blocks.slice(at + 1)] };
}
const shortCaption = (caption: string) => caption.length <= 30 ? caption : caption.slice(0, 30).replace(/\s+\S*$/, "").trim();

export function toArticleViewData(article: ReferenceArticleView, options: ArticleDataOptions): ArticleViewData {
  const infoboxPicture = article.infobox?.image;
  const figureHero = !infoboxPicture && !article.lead_image ? firstFigureHero(article.blocks) : null;
  // A page with a facts card opens with its first picture beside the first paragraph, as in the owner's article mockup.
  const withFigureFirst = (blocks: ReferenceBlock[]): ReferenceBlock[] => {
    const at = blocks.findIndex((block) => block.type === "figure");
    const start = blocks.findIndex((block) => block.type === "paragraph");
    return at > start && start >= 0 ? [blocks[at]!, ...blocks.slice(0, at), ...blocks.slice(at + 1)] : blocks;
  };
  const blocksIn = figureHero ? figureHero.rest : article.infobox && article.infobox.rows.length ? withFigureFirst(article.blocks) : article.blocks;
  const kicker = article.kicker;
  // The standfirst is the hero page's look (the Aurora mockup); a page with a facts card (the Zendaya mockup) opens with its normal first paragraph.
  const standfirst = article.infobox && article.infobox.rows.length ? undefined : article.lead;
  return {
    title: article.title,
    ...(kicker ? { kicker, kickerStyle: "chip" as const } : {}),
    description: article.description ?? (article.reading_minutes ? `${article.source_label} · ${article.reading_minutes} min read` : article.source_label),
    ...(standfirst ? { lead: standfirst } : {}),
    breadcrumb: [{ label: options.appName, onClick: options.onAppHome }, ...(kicker ? [{ label: kicker, ...(options.onCategory ? { onClick: () => options.onCategory!(kicker) } : {}) }] : []), { label: article.title }],
    ...(article.infobox && article.infobox.rows.length ? { infobox: article.infobox } : {}),
    ...(figureHero ? { image: { w480: figureHero.hero.src, w1280: figureHero.hero.src, alt: figureHero.hero.alt, ...(figureHero.hero.caption ? { badge: shortCaption(figureHero.hero.caption) } : {}) } } : {}),
    ...(!infoboxPicture && article.lead_image ? { image: { w480: article.lead_image.src, w1280: article.lead_image.src, alt: article.lead_image.alt, ...(article.badge ? { badge: article.badge } : {}) } } : {}),
    ...(article.quick_fact ? { quick_fact: article.quick_fact } : {}),
    ...(article.related?.length ? { related: article.related.map((item) => ({ target: { book: item.book, path: item.path }, title: item.title, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}) })) } : {}),
    contents: article.toc.filter((item) => item.level >= 2 && item.level <= 4).map((item) => ({ id: item.id, title: item.title, level: item.level as 2 | 3 | 4 })),
    foldSections: true,
    floatFirstFigure: true,
    actionRow: infoboxPicture ? "top" : "under-hero",
    blocks: withoutLead(blocksIn.map(asBlock), standfirst),
  };
}
