// Small text helpers the media parsers share.
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/** Plain text from a fragment of XML or HTML: tags dropped, entities decoded, whitespace collapsed. */
export function plainText(fragment: string, max = 2000): string {
  const unwrapped = fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** "the.big.show" -> "the big show"; a name that already has spaces is only trimmed. */
export function spaced(name: string): string {
  const base = name.trim();
  return (base.includes(" ") ? base : base.replace(/[._]+/g, " ")).replace(/\s+/g, " ").trim();
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** A title reduced for matching: lowercase, accents and punctuation gone. */
export function matchKey(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
