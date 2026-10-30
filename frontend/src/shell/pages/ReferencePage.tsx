import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Card } from "@maipai/ui/src/primitives/Card";
import { List } from "@maipai/ui/src/primitives/List";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { ArticleView, type ArticleBlockData, type ArticleInlineData, type ArticleViewData } from "@maipai/ui/src/primitives/ArticleView";
import { api, ApiError, type ReferenceArticleView, type ReferenceBlock, type ReferenceInline, type ReferenceSearchHit, type ReferenceSuggestion } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

const routeFor = (book: string, path: string) => `/reference/${encodeURIComponent(book)}/${path.split("/").map(encodeURIComponent).join("/")}`;
const sizeLabel = (bytes: number | null) => bytes === null ? "Size unavailable" : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(0)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;

// NEWS-01: the article is drawn by the kit's one reader, ArticleView (the hand-drawn ArticleContent is gone, rule 12).
// This adapter maps the Reference API's blocks onto the view's closed block model; behaviour kept from the old drawing:
// heading ids for the table of contents, book links through the router, plain-text links for a child (the API sends none),
// figures only when the API sent them, and the licence and snapshot line under the article.
function asInline(value: ReferenceInline): ArticleInlineData {
  if (typeof value === "string") return { type: "text", text: value };
  if (value.type === "link") return value.book && value.path ? { type: "link", text: value.text, target: { book: value.book, path: value.path } } : { type: "text", text: value.text };
  return value;
}

function asBlock(block: ReferenceBlock): ArticleBlockData {
  switch (block.type) {
    case "heading": return { ...block, level: Math.min(4, Math.max(2, block.level)) as 2 | 3 | 4 };
    case "paragraph": return { type: "paragraph", inlines: block.inlines.map(asInline) };
    case "list": return { type: "list", ordered: block.ordered, items: block.items.map((item) => item.map(asInline)) };
    case "figure": return { ...block, caption: block.caption ?? "" };
    case "rows":
    case "table":
    case "note": return block;
  }
}

function articleData(article: ReferenceArticleView): ArticleViewData {
  return { title: article.title, description: article.source_label, blocks: article.blocks.map(asBlock) };
}

export function ReferencePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeMatch = location.pathname.match(/^\/reference\/([^/]+)(?:\/(.*))?$/);
  const book = routeMatch ? decodeURIComponent(routeMatch[1]!) : undefined;
  const path = routeMatch?.[2] ? routeMatch[2].split("/").map(decodeURIComponent).join("/") : undefined;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  useTabItem("Reference");
  const booksQuery = useQuery({ queryKey: ["reference-books"], queryFn: api.referenceBooks });
  const books = booksQuery.data ?? [];
  const suggestionsQuery = useQuery<ReferenceSuggestion[]>({ queryKey: ["reference-suggest", book, debounced], queryFn: () => api.referenceSuggest(book, debounced), enabled: Boolean(debounced.trim()), staleTime: 30_000 });
  const articleQuery = useQuery<ReferenceArticleView>({ queryKey: ["reference-article", book, path], queryFn: () => api.referenceArticle(book!, path!), enabled: Boolean(book && path), retry: false });
  const searchParams = new URLSearchParams(location.search);
  const resultsQuery = useQuery<ReferenceSearchHit[]>({ queryKey: ["reference-search", searchParams.get("q"), searchParams.get("book")], queryFn: () => api.referenceSearch(searchParams.get("q")!, searchParams.get("book") ?? undefined), enabled: Boolean(!book && searchParams.get("q")), retry: false });
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { if (articleQuery.data) document.getElementById("reference-article")?.scrollTo(0, 0); }, [articleQuery.data]);
  const toc = useMemo(() => articleQuery.data?.toc ?? [], [articleQuery.data?.toc]);
  const suggestions = suggestionsQuery.data ?? [];
  const articleError = articleQuery.error;
  const unavailable = articleError instanceof ApiError && articleError.status === 404;
  const resultQuery = searchParams.get("q") ?? "";
  const title = articleQuery.data?.title ?? (book ? "Reference" : "Reference");
  const formattedToc = useMemo(() => toc.map((item) => ({ ...item, label: item.title })), [toc]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim()) navigate(`/reference?${new URLSearchParams({ q: query.trim(), ...(book ? { book } : {}) })}`);
  }

  return <Page title={title} hideTitle={title === "Reference"}>
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4">
      {book && path ? <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Back</Button>
        <Button variant="outline" onClick={() => navigate(1)}>Forward</Button>
        <Button variant="outline" asChild><Link to="/reference">All books</Link></Button>
        {toc.length ? <span className="md:hidden"><Button variant="outline" onClick={() => setTocOpen(true)}>Contents</Button></span> : null}
      </div> : null}
      <form onSubmit={submitSearch} className="flex min-w-0 gap-2">
        <Input aria-label="Search reference" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" autoComplete="off" />
        <Button type="submit">Search</Button>
      </form>
      {!path && suggestions.length && query.trim() ? <ul aria-label="Suggested articles" className="flex min-w-0 flex-col">{suggestions.map((item) => <li key={`${item.book}:${item.path}`}><Button asChild variant="link"><Link to={routeFor(item.book, item.path)}>{item.title}</Link></Button></li>)}</ul> : null}
      {book && path ? <>
        {articleQuery.isPending ? <p role="status">Loading article…</p> : null}
        {unavailable ? <p role="status">This article is not available.</p> : null}
        {articleQuery.isError && !unavailable ? <p role="alert">Could not load this article.</p> : null}
        {articleQuery.data ? <div className="grid min-w-0 gap-6 md:grid-cols-4">
          {toc.length ? <nav aria-label="Table of contents" className="hidden md:block"><h2 className="mb-2 font-semibold">Contents</h2><List label="Article contents" items={formattedToc} getKey={(item) => item.id} onSelect={(item) => document.getElementById(item.id)?.scrollIntoView()} renderItem={(item) => <span className="min-w-0 break-words">{item.label}</span>} /></nav> : null}
          <div id="reference-article" data-touch-target-exempt className="min-w-0">
            <ArticleView
              data={articleData(articleQuery.data)}
              renderTargetLink={(target, text) => <Link className="underline underline-offset-2" to={routeFor(target.book, target.path)}>{text}</Link>}
              footer={<>{articleQuery.data.licence} · Snapshot {articleQuery.data.snapshot_date ?? "date unavailable"}</>}
            />
          </div>
        </div> : null}
        <Sheet open={tocOpen} onOpenChange={setTocOpen}><SheetContent side="bottom"><SheetHeader><SheetTitle>Contents</SheetTitle></SheetHeader><List label="Article contents" items={formattedToc} getKey={(item) => item.id} onSelect={(item) => { setTocOpen(false); document.getElementById(item.id)?.scrollIntoView(); }} renderItem={(item) => <span>{item.title}</span>} /></SheetContent></Sheet>
      </> : null}
      {!book && resultQuery ? <section aria-label="Search results"><h2 className="text-xl font-semibold">Results for {resultQuery}</h2>{resultsQuery.isPending ? <p role="status">Searching…</p> : null}<List label="Reference search results" items={resultsQuery.data ?? []} getKey={(hit) => `${hit.book}:${hit.path}`} getLabel={(hit) => hit.title} onSelect={(hit) => navigate(routeFor(hit.book, hit.path))} renderItem={(hit) => <div className="min-w-0"><p className="font-medium">{hit.title}</p><p className="break-words text-muted-foreground">{hit.snippet}</p></div>} emptyState={{ icon: "book-open", text: "No articles found." }} /></section> : null}
      {!book && !resultQuery ? <section><h2 className="text-xl font-semibold">Your library</h2>{booksQuery.isPending ? <p role="status">Loading library…</p> : null}<div className="grid min-w-0 gap-3 sm:grid-cols-2">{books.map((item) => <Card key={item.id} className="min-w-0 p-4"><h3 className="break-words font-semibold">{item.source_label}</h3><p>{item.language ?? "Language unavailable"} · {sizeLabel(item.size_bytes)}</p><p className="text-muted-foreground">Snapshot {item.snapshot_date ?? "date unavailable"} · {item.article_count.toLocaleString()} articles</p><p className="text-muted-foreground">{item.licence}</p><Button asChild variant="link"><Link to={`/reference/${encodeURIComponent(item.id)}`}>Browse this book</Link></Button></Card>)}</div>{booksQuery.isError ? <p role="alert">Could not load your library.</p> : null}</section> : null}
      {book && !path && !resultQuery ? <section><h2 className="text-xl font-semibold">{books.find((item) => item.id === book)?.source_label ?? "Browse this book"}</h2><p>Search for an article in this book.</p>{query.trim() && !suggestions.length ? <p>No matching article titles.</p> : null}</section> : null}
    </div>
  </Page>;
}
