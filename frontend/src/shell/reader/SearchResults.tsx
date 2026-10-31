import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArticleCard } from "./ArticleCard";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { List } from "@maipai/ui/src/primitives/List";
import { api, type ReferenceBookView } from "@/lib/api";

const RELATED_STALE_MS = 10 * 60 * 1000;
const RELATED_MAX = 5;

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
  const related = useQuery({ queryKey: ["reference-related", q, book ?? null], queryFn: () => api.referenceSuggest(book ?? books[0]?.id, q), enabled: books.length > 0, staleTime: RELATED_STALE_MS, retry: false });
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
          renderItem={(hit) => <ArticleCard book={hit.book} path={hit.path} title={hit.title} snippet={hit.snippet} />}
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
