// ZIM-IMG-01: the pure `extractArticleImages` function. Kiwix article HTML
// in, a list of book-local picture paths out. No network.
import { parseHTML } from "linkedom";

type Element = ReturnType<typeof parseHTML>["document"]["body"];

export type ArticleImage = { imagePath: string; alt: string; caption: string; lead: boolean; width?: number; height?: number };

const LEAD_SELECTOR = "table.infobox, table.infobox_v2, table.infobox_v3, .infobox";
const CONTAINER_SELECTOR = "figure, .thumb, .thumbinner, .gallerybox";
const CAPTION_SELECTOR = "figcaption, .thumbcaption, .gallerytext";
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif)$/i;
const NON_LEAD_MIN_PX = 200;
const LEAD_MIN_PX = 100;
const CAPTION_MAX_CHARS = 300;
const DEFAULT_LIMIT = 8;

function collapse(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function declaredSize(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveImagePath(src: string, base: string, bookPrefix: string): string | null {
  const pathOnly = src.split(/[?#]/)[0] ?? "";
  if (!IMAGE_EXTENSION.test(pathOnly)) return null;
  const url = new URL(src, base);
  if (!url.pathname.startsWith(bookPrefix)) return null;
  const segments = url.pathname.slice(bookPrefix.length).split("/");
  const decoded: string[] = [];
  for (const segment of segments) {
    let value: string;
    try { value = decodeURIComponent(segment); } catch { return null; }
    if (value === "" || value === "." || value === "..") return null;
    decoded.push(value);
  }
  return decoded.join("/");
}

export function extractArticleImages(html: string, opts: { book: string; articlePath: string; limit?: number }): ArticleImage[] {
  try {
    const { document } = parseHTML(html);
    const bookPrefix = "/content/" + encodeURIComponent(opts.book) + "/";
    const articlePath = opts.articlePath.split("/").map(encodeURIComponent).join("/");
    const base = "http://kiwix.local" + bookPrefix + articlePath;
    const kept: ArticleImage[] = [];
    const byPath = new Map<string, ArticleImage>();
    for (const img of Array.from(document.querySelectorAll("img")) as Element[]) {
      const isLead = img.closest(LEAD_SELECTOR) !== null;
      if (!isLead && img.closest(CONTAINER_SELECTOR) === null) continue;
      const src = img.getAttribute("src");
      if (src === null || src === "") continue;
      if (/^(?:data:|https?:|\/\/)/i.test(src)) continue;
      if ((img.getAttribute("class") ?? "").includes("mwe-math")) continue;
      if (src.includes("/math/render")) continue;
      const imagePath = resolveImagePath(src, base, bookPrefix);
      if (imagePath === null) continue;
      const width = declaredSize(img.getAttribute("width"));
      const height = declaredSize(img.getAttribute("height"));
      const min = isLead ? LEAD_MIN_PX : NON_LEAD_MIN_PX;
      if ((width !== undefined && width < min) || (height !== undefined && height < min)) continue;
      const container = img.closest(CONTAINER_SELECTOR);
      const captionNode = container ? (container.querySelector(CAPTION_SELECTOR) as Element | null) : null;
      let caption = "";
      if (captionNode) {
        const clone = captionNode.cloneNode(true) as Element;
        clone.querySelectorAll(".magnify").forEach((node: Element) => node.remove());
        caption = collapse(clone.textContent ?? "").slice(0, CAPTION_MAX_CHARS);
      }
      const image: ArticleImage = {
        imagePath,
        alt: collapse(img.getAttribute("alt") ?? ""),
        caption,
        lead: isLead,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      };
      const existing = byPath.get(imagePath);
      if (existing) { existing.lead = existing.lead || isLead; continue; }
      byPath.set(imagePath, image);
      kept.push(image);
    }
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return [...kept.filter((image) => image.lead), ...kept.filter((image) => !image.lead)].slice(0, limit);
  } catch {
    return [];
  }
}
