import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Card } from "@maipai/ui/src/primitives/Card";
import { Page } from "@maipai/ui/src/primitives/Page";
import { api, type ReferenceSuggestion } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { ReaderArticle } from "@/shell/reader/ReaderArticle";
import { SearchResults } from "@/shell/reader/SearchResults";

const routeFor = (book: string, path: string) => `/reference/${encodeURIComponent(book)}/${path.split("/").map(encodeURIComponent).join("/")}`;
const sizeLabel = (bytes: number | null) => bytes === null ? "Size unavailable" : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(0)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;

// READER-03: Reference draws its article and its results through the shared reader (shell/reader), the same one the Wikipedia app uses.
export function ReferencePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeMatch = location.pathname.match(/^\/reference\/([^/]+)(?:\/(.*))?$/);
  const book = routeMatch ? decodeURIComponent(routeMatch[1]!) : undefined;
  const path = routeMatch?.[2] ? routeMatch[2].split("/").map(decodeURIComponent).join("/") : undefined;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useTabItem("Reference");
  const booksQuery = useQuery({ queryKey: ["reference-books"], queryFn: api.referenceBooks });
  const books = booksQuery.data ?? [];
  const suggestionsQuery = useQuery<ReferenceSuggestion[]>({ queryKey: ["reference-suggest", book, debounced], queryFn: () => api.referenceSuggest(book, debounced), enabled: Boolean(debounced.trim()), staleTime: 30_000 });
  const searchParams = new URLSearchParams(location.search);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  const suggestions = suggestionsQuery.data ?? [];
  const resultQuery = searchParams.get("q") ?? "";
  const resultBook = searchParams.get("book") ?? undefined;
  const title = book && path ? "Reference" : "Reference";

  function search(q: string, within?: string) {
    if (q.trim()) navigate(`/reference?${new URLSearchParams({ q: q.trim(), ...(within ? { book: within } : {}) })}`);
  }

  return <Page title={title} hideTitle>
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4">
      <form onSubmit={(event) => { event.preventDefault(); search(query, book); }} className="flex min-w-0 gap-2">
        <Input aria-label="Search reference" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" autoComplete="off" />
        <Button type="submit">Search</Button>
      </form>
      {!path && suggestions.length && query.trim() ? <ul aria-label="Suggested articles" className="flex min-w-0 flex-col">{suggestions.map((item) => <li key={`${item.book}:${item.path}`}><Button asChild variant="link"><Link to={routeFor(item.book, item.path)}>{item.title}</Link></Button></li>)}</ul> : null}
      {book && path ? <ReaderArticle book={book} path={path} routeFor={routeFor} appName="Reference" onAppHome={() => navigate("/reference")} /> : null}
      {!book && resultQuery ? <SearchResults q={resultQuery} {...(resultBook ? { book: resultBook } : {})} books={books} routeFor={routeFor} onBook={(next) => search(resultQuery, next)} onSearch={(next) => search(next, resultBook)} /> : null}
      {!book && !resultQuery ? <section><h2 className="text-xl font-semibold">Your library</h2>{booksQuery.isPending ? <p role="status">Loading library…</p> : null}<div className="grid min-w-0 gap-3 sm:grid-cols-2">{books.map((item) => <Card key={item.id} className="min-w-0 p-4"><h3 className="break-words font-semibold">{item.source_label}</h3><p>{item.language ?? "Language unavailable"} · {sizeLabel(item.size_bytes)}</p><p className="text-muted-foreground">Snapshot {item.snapshot_date ?? "date unavailable"} · {item.article_count.toLocaleString()} articles</p><p className="text-muted-foreground">{item.licence}</p><Button asChild variant="link"><Link to={`/reference/${encodeURIComponent(item.id)}`}>Browse this book</Link></Button></Card>)}</div>{booksQuery.isError ? <p role="alert">Could not load your library.</p> : null}</section> : null}
      {book && !path && !resultQuery ? <section><h2 className="text-xl font-semibold">{books.find((item) => item.id === book)?.source_label ?? "Browse this book"}</h2><p>Search for an article in this book.</p>{query.trim() && !suggestions.length ? <p>No matching article titles.</p> : null}</section> : null}
    </div>
  </Page>;
}
