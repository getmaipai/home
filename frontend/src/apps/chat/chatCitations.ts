import type { Source } from "@maipai/spec/gen/ts/source.js";
import { createElement } from "react";

export type TurnWithSources = { sources?: Source[] };
export type TurnWithMedia = { media?: { kind: "image"; url: string; thumbnail: string | null; source: string } };

export function ChatMedia({ media, sources }: { media: TurnWithMedia["media"]; sources?: Source[] }) {
  if (media?.kind !== "image" || !sources?.[0]) return null;
  return createElement("a", { href: sources[0].url, target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" }, createElement("img", { src: media.thumbnail ?? media.url, alt: `From ${media.source}`, loading: "lazy", className: "max-w-full rounded-xl" }));
}

const MARKER_RE = /\[(\d+)\]/g;
// A fenced block (```…```) or an inline span (`…`) - split()'s own
// capturing group hands these back too, always at an odd index, so a
// marker inside either is left completely alone: the model quoting a
// literal `items[2]` in a code example must render as code, not a link.
const CODE_SPAN_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/** Rewrites a `[N]` inline citation marker into a real markdown link,
 * `[N](#citation-N)`, when N is a 1-based index into `sources` -
 * chatCitationLink.tsx's `a` override then intercepts the `#citation-`
 * fragment and renders a chip instead of following it. A fragment, not a
 * made-up URI scheme like `citation:N`: react-markdown's default
 * `urlTransform` allows only a fixed protocol list (http/https/mailto/
 * tel) plus relative/fragment links, silently rewriting anything else to
 * `href=""` for the same reason it strips `javascript:` - a custom
 * scheme was found live to disappear exactly that way. A marker with no
 * matching source is left exactly as written, plain text (the design
 * note's own "a [7] with two sources stays text"). Pass this to
 * MarkdownTextPrimitive's own `preprocess` prop, which always runs on
 * the full accumulated reply text, never one streamed delta alone - the
 * same discipline the design note requires ("accumulate the whole text
 * before parsing because a marker can split across streaming chunks"):
 * a delta that ends mid-marker (text ending in "[") simply doesn't match
 * yet and stays as-is until the closing "]" arrives in a later delta. */
export function markCitations(text: string, sources: Source[] | undefined): string {
  if (!sources || sources.length === 0) return text;
  return text
    .split(CODE_SPAN_RE)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment.replace(MARKER_RE, (whole, digits: string) => {
            const n = Number(digits);
            return n >= 1 && n <= sources.length ? `[${n}](#citation-${n})` : whole;
          }),
    )
    .join("");
}

/** The inverse half: pulls the 1-based index back out of a `#citation-N`
 * href, or null for any other link (a real URL a reply also contains). */
export function parseCitationHref(href: string | undefined): number | null {
  if (!href) return null;
  const match = /^#citation-(\d+)$/.exec(href);
  return match ? Number(match[1]) : null;
}
