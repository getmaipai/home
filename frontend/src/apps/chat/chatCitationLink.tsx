import type { AnchorHTMLAttributes } from "react";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import { parseCitationHref } from "@/apps/chat/chatCitations";
import { MARKDOWN_LINK_CLASS } from "@maipai/ui/src/assistant-ui/markdown-text";
import { Button } from "@maipai/ui/src/ui/button";
import { cn } from "@maipai/ui/src/utils";

/** markdown-text.tsx's `a` override for a chat reply: chatCitations.ts's
 * markCitations() rewrites a matched `[N]` marker into a real markdown
 * link, `[N](#citation-N)`, before this ever sees it - this intercepts
 * that fragment and renders a small chip that opens and highlights the
 * matching row in the reply's own SourcesCard (spec.md "Inside a turn":
 * "Citations in the body are superscript numbers that scroll the card
 * open and highlight the row") instead of following it as a link - the
 * source's real url is one tap further, on the opened row itself, the
 * same no-referrer link SourcesCard's own rows use. `onCite` is thread.
 * aui.tsx's own handler, since it owns the SourcesCard's open state and
 * the DOM node to scroll/highlight; this component only renders the
 * trigger. Anything else (a real URL the reply also contains) falls
 * through to the same plain-link styling markdown-text.tsx's own
 * default `a` component uses, since supplying `components` to
 * MarkdownText replaces the whole entry, not just the citation case. */
export function createCitationComponents(sources: Source[] | undefined, onCite: (sourceId: string) => void) {
  return {
    a: ({ href, children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const index = parseCitationHref(href);
      const source = index !== null ? sources?.[index - 1] : undefined;
      if (source) {
        return (
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            onClick={() => onCite(source.id)}
            aria-label={`Source ${index}: ${source.title}`}
            // text-xs, not text-base: a documented type-floor exception
            // (docs/UI.md, lane 7 item 3), the same footnote-marker
            // carve-out markdown-text.tsx's own `sup` override and
            // MemoryChip's own chip class already use - `icon-xs`'s own
            // hitArea() extension still gives this a real 48px tap
            // target despite the compact visible size.
            className="mx-0.5 h-auto w-auto min-w-4 rounded-full px-1.5 py-0.5 align-text-top text-xs font-medium"
          >
            {index}
          </Button>
        );
      }
      return (
        <a href={href} className={cn(MARKDOWN_LINK_CLASS, className)} {...props}>
          {children}
        </a>
      );
    },
  };
}
