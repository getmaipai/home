import type { parseHTML } from "linkedom";

type Document = ReturnType<typeof parseHTML>["document"];
type Element = Document["body"];

const textOf = (element: Element): string => (element.textContent ?? "").replace(/\s+/g, " ").trim();

/** Recognize short publisher subscription copy without trimming article prose. */
export function isPromoText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length > 180) return false;
  return /^(?:sign up for|subscribe to|get our|get the)\b.{0,120}\b(?:email|newsletter|podcast|app|briefing)\b/i.test(normalized)
    || /delivered to your inbox|skip past newsletter promotion/i.test(normalized);
}

// Accept formatting around a link, but no other visible words or media.
function onlyLink(element: Element, prefix?: RegExp): boolean {
  const anchors = element.querySelectorAll("a[href]");
  if (anchors.length !== 1 || !textOf(anchors[0]!)) return false;
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("a").forEach((anchor: Element) => anchor.remove());
  const remainder = textOf(clone);
  return !clone.querySelector("img, video, audio") && (prefix ? prefix.test(remainder) : remainder === "");
}

function isTail(element: Element): boolean {
  let current: Element | null = element;
  while (current && !current.matches("article, main, body")) {
    if (current.nextElementSibling) return false;
    for (let sibling = current.nextSibling; sibling; sibling = sibling.nextSibling) {
      if ((sibling.textContent ?? "").trim()) return false;
    }
    current = current.parentElement;
  }
  return current !== null;
}

// A wrapper whose class merely contains "share" or "promo" must never take the story with it.
function holdsArticle(element: Element): boolean {
  if (element.matches("article, main, body")) return true;
  if (element.querySelector("article, main")) return true;
  return Array.from(element.querySelectorAll("p")).filter((p) => textOf(p).length > 120).length >= 3;
}

/** Remove publisher chrome from a parsed document, with no I/O or external state. */
export function cleanArticleDocument(document: Document): void {
  for (const element of document.querySelectorAll("[data-component], [data-spacefinder-type], [data-print-layout='hide'], p[role='note'], [class]")) {
    if (holdsArticle(element)) continue;
    if (element.matches("[data-print-layout='hide'], p[role='note']")
      || /^(?:ad-slot|advertisement|tag-list|topic-list|byline|related|share-tools|newsletter|promo)/i.test(element.getAttribute("data-component") ?? "")
      || /(?:RichLinkBlockElement|LinkBlockElement|NewsletterSignupBlockElement|EmailSignupBlockElement)$/.test(element.getAttribute("data-spacefinder-type") ?? "")
      || /newsletter|subscribe|byline|dateline|promo|related-links|read-more|share|image-credit|photo-credit/i.test(element.getAttribute("class") ?? "")) element.remove();
  }
  for (const anchor of document.querySelectorAll('a[href^="#"]')) {
    if (/^skip (?:past|to)\b/i.test(textOf(anchor))) anchor.remove();
  }
  for (const paragraph of document.querySelectorAll("p")) {
    const text = textOf(paragraph);
    if (isPromoText(text) || /^(?:posted|published|updated)\s+(?:(?:on|at|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d+(?:st|nd|rd|th)?)[\s,./:-]+)*\d{1,2}(?::\d{2})?\s*[ap]m(?:\s+[A-Z]{2,5})?\s*\.?$/i.test(text)) paragraph.remove();
  }
  const captions = new Set<string>();
  for (const caption of document.querySelectorAll("figcaption")) {
    const text = textOf(caption);
    if (text && captions.has(text)) caption.remove();
    else if (text) captions.add(text);
  }
  for (const list of document.querySelectorAll("ul, ol")) {
    const heading = list.previousElementSibling;
    const items = Array.from(list.children) as Element[];
    if (!heading || !/^H[1-6]$/.test(heading.tagName) || !/related|more (stories|from)|you may also like|recommended|trending/i.test(textOf(heading)) || !isTail(list)) continue;
    if (items.length && items.every((item) => {
      const href = item.querySelector("a[href]")?.getAttribute("href") ?? "";
      if (item.tagName !== "LI" || !onlyLink(item) || !href.trim() || href.trim().startsWith("#")) return false;
      try { return /^https?:$/.test(new URL(href, "https://example.com/").protocol); }
      catch { return false; }
    })) { heading.remove(); list.remove(); }
  }
  for (const element of document.querySelectorAll("p, li")) {
    if (/^(?:read more|related):\s*/i.test(textOf(element)) && onlyLink(element, /^(?:(?:read more|related):)?\s*$/i)) element.remove();
  }
}
