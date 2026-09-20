import type { AnchorHTMLAttributes } from "react";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import { parseCitationHref } from "@/apps/chat/chatCitations";
import { MARKDOWN_LINK_CLASS } from "@/kit/assistant-ui/markdown-text";
import { cn } from "@maipai/ui/src/utils";

/** markdown-text.tsx's `a` override for a chat reply: chatCitations.ts's
 * markCitations() rewrites a matched `[N]` marker into a real markdown
 * link, `[N](#citation-N)`, before this ever sees it - this intercepts
 * that fragment and renders a small chip naming the source instead of
 * following it, opening the source's own url in a new tab the same
 * no-referrer way SourcesCard's own links do. Anything else (a real URL
 * the reply also contains) falls through to the same plain-link styling
 * markdown-text.tsx's own default `a` component uses, since supplying
 * `components` to MarkdownText replaces the whole entry, not just the
 * citation case. */
export function createCitationComponents(sources: Source[] | undefined) {
  return {
    a: ({ href, children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const index = parseCitationHref(href);
      const source = index !== null ? sources?.[index - 1] : undefined;
      if (source) {
        return (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            aria-label={`Source ${index}: ${source.title}`}
            // text-xs, not text-base: a documented type-floor exception
            // (docs/UI.md, lane 7 item 3), the same footnote-marker
            // carve-out markdown-text.tsx's own `sup` override and
            // chatMemoryChip.tsx's CHIP_CLASS already use.
            className="mx-0.5 inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 align-text-top text-xs font-medium text-secondary-foreground no-underline"
          >
            {index}
          </a>
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
