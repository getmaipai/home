import type { Source } from "@maipai/spec/gen/ts/source.js";

/** Rendered under a settled assistant reply that carries sources
 * (docs/BACKLOG.md's "Inline citation markers on sourced answers"):
 * the numbered list every `[N]` chip (chatCitationLink.tsx) points back
 * into. `target="_blank"` with `rel="noopener noreferrer"` and
 * `referrerPolicy="no-referrer"` on every link is the privacy page's own
 * promise - a cited site learns nothing from the click but the click. No
 * favicon: fetching one per source is the favicon proxy's own backlog
 * item, which waits for this citation work to have something to cache. */
export function SourcesCard({ sources }: { sources: Source[] | undefined }) {
  if (!sources || sources.length === 0) return null;
  return (
    <ol className="mt-2 flex flex-col gap-1.5 rounded-xl border border-border/70 bg-card p-3 text-base">
      {sources.map((source, i) => (
        <li key={source.id} className="flex gap-2">
          <span className="text-muted-foreground">{i + 1}.</span>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="min-w-0 truncate text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:text-primary/80"
          >
            {source.title}
            <span className="text-muted-foreground"> · {source.site}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
