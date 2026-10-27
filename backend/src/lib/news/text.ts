// NEWS-TEXT-01: feed summaries arrive as the publisher wrote them: markup, entities (`&#8217;`), bare addresses and the aggregator's own
// "Article URL / Comments URL / Points" line. A card's description is plain words only.
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", rdquo: "\"", ldquo: "\"" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
      const char = String.fromCodePoint(code);
      return char === "—" || char === "–" ? "-" : char;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** A feed summary as plain text: tags and aggregator boilerplate removed, entities decoded, addresses dropped, spaces collapsed. */
export function plainSummary(raw: string): string {
  let text = raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(decodeEntities(text)).replace(/<[^>]*>/g, " ");
  text = text
    .replace(/\bArticle URL:\s*\S+/gi, " ")
    .replace(/\bComments URL:\s*\S+/gi, " ")
    .replace(/\bPoints:\s*\d+/gi, " ")
    .replace(/#\s*Comments:\s*\d+/gi, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b(?:The post|The article)\b.{0,160}\bappeared first on\b.*$/i, " ")
    .replace(/\s*(?:Read more|Continue reading|Read the full (?:story|article))\b.*$/i, " ");
  return text.replace(/\s+/g, " ").trim();
}
