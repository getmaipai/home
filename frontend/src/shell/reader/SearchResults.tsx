import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { List } from "@maipai/ui/src/primitives/List";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type ReferenceBookView, type ReferenceSearchHit } from "@/lib/api";

const ChevronRight = getIcon("chevron-right");
const PREVIEW_STALE_MS = 10 * 60 * 1000;
const RELATED_MAX = 5;

/** True once the element has come near the screen; a browser without IntersectionObserver counts as seen at once. */
function useSeen(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** One result: the hit's own title and snippet at once, the picture, description and category once the card is on screen. */
function ResultRow({ hit }: { hit: ReferenceSearchHit }) {
  const [ref, seen] = useSeen();
  const preview = useQuery({ queryKey: ["reference-preview", hit.book, hit.path], queryFn: () => api.referencePreview(hit.book, hit.path), enabled: seen, staleTime: PREVIEW_STALE_MS, retry: false });
  const data = preview.data;
  return (
    <div ref={ref} data-slot="reader-result" className="flex w-full min-w-0 items-center gap-4 rounded-xl border bg-card p-3">
      {data?.thumbnail ? <img src={data.thumbnail.src} alt={data.thumbnail.alt} loading="lazy" className="h-28 w-24 shrink-0 rounded-lg object-cover sm:h-32 sm:w-28" /> : preview.isPending && seen ? <div aria-hidden className="h-28 w-24 shrink-0 rounded-lg bg-muted sm:h-32 sm:w-28" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{hit.title}</p>
        {data?.description ? <p className="text-muted-foreground text-sm">{data.description}</p> : null}
        {data?.kicker ? <div className="my-1.5"><Chip>{data.kicker}</Chip></div> : null}
        <p className="text-muted-foreground line-clamp-2 break-words text-sm">{hit.snippet || data?.lead || data?.summary}</p>
      </div>
      <ChevronRight aria-hidden className="text-muted-foreground size-5 shrink-0" />
    </div>
  );
}

export interface SearchResultsProps {
  q: string;
  /** The book the page is limited to, when the person picked one. */
  book?: string;
  books: ReferenceBookView[];
  routeFor: (book: string, path: string) => string;
  onBook: (book: string | undefined) => void;
  onSearch: (q: string) => void;
}

/** READER-11: results with a count, a filter chip per readable book, lazy previews, and Related searches from the books' own titles. */
export function SearchResults({ q, book, books, routeFor, onBook, onSearch }: SearchResultsProps) {
  const navigate = useNavigate();
  const results = useQuery({ queryKey: ["reference-search-page", q, book ?? null], queryFn: () => api.referenceSearchPage(q, book), retry: false });
  const related = useQuery({ queryKey: ["reference-related", q, book ?? null], queryFn: () => api.referenceSuggest(book ?? books[0]?.id, q), enabled: books.length > 0, staleTime: PREVIEW_STALE_MS, retry: false });
  const hits = results.data?.hits ?? [];
  const total = results.data?.total ?? 0;
  const topPath = hits[0]?.path;
  const relatedTitles = (related.data ?? []).filter((item) => item.path !== topPath && item.title.toLowerCase() !== q.toLowerCase()).slice(0, RELATED_MAX);
  return (
    <section aria-label="Search results" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Search results for “{q}”</h2>
        {results.data ? <p className="text-muted-foreground text-sm">{total > hits.length ? `About ${total.toLocaleString()} results` : `${hits.length.toLocaleString()} ${hits.length === 1 ? "result" : "results"}`}</p> : null}
      </div>
      {books.length > 1 ? (
        <div role="group" aria-label="Filter results by book" className="flex flex-wrap gap-2">
          <Chip selected={book === undefined} onClick={() => onBook(undefined)}>All</Chip>
          {books.map((item) => <Chip key={item.id} selected={book === item.id} onClick={() => onBook(item.id)}>{item.source_label}</Chip>)}
        </div>
      ) : null}
      {results.isPending ? <p role="status">Searching…</p> : null}
      {results.isError ? <p role="alert">Could not search right now.</p> : null}
      {results.data ? (
        <List
          label="Reference search results"
          items={hits}
          getKey={(hit) => `${hit.book}:${hit.path}`}
          getLabel={(hit) => hit.title}
          onSelect={(hit) => navigate(routeFor(hit.book, hit.path))}
          renderItem={(hit) => <ResultRow hit={hit} />}
          emptyState={{ icon: "book", text: "No articles found." }}
        />
      ) : null}
      {relatedTitles.length ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Related searches">
          <span className="text-muted-foreground text-sm font-semibold">Related searches</span>
          {relatedTitles.map((item) => <Chip key={`${item.book}:${item.path}`} onClick={() => onSearch(item.title)}>{item.title}</Chip>)}
        </div>
      ) : null}
    </section>
  );
}
