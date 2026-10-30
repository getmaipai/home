import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Page } from "@maipai/ui/src/primitives/Page";
import { api, type ReferenceBookView } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { ReaderArticle } from "@/shell/reader/ReaderArticle";
import { ReaderSearchBox } from "@/shell/reader/SearchBox";
import { SearchResults } from "@/shell/reader/SearchResults";
import { useReferenceSaves } from "@/shell/reader/saves";

const RECENT_KEY = "maipai.wikipedia.recent";
const RECENT_MAX = 8;
const EXPLORE_COUNT = 6;

export interface RecentArticle { book: string; path: string; title: string }

const articleRoute = (book: string, path: string) => `/wikipedia/a/${encodeURIComponent(book)}/${encodeURIComponent(path)}`;

/** Recently opened articles live in this browser's session only (nothing is stored on the hub; the design keeps history short and private). */
function readRecent(): RecentArticle[] {
  try { const parsed: unknown = JSON.parse(window.sessionStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(parsed) ? parsed.filter((x): x is RecentArticle => typeof x?.book === "string" && typeof x?.path === "string" && typeof x?.title === "string").slice(0, RECENT_MAX) : []; } catch { return []; }
}
function remember(entry: RecentArticle) {
  try { window.sessionStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...readRecent().filter((x) => !(x.book === entry.book && x.path === entry.path))].slice(0, RECENT_MAX))); } catch { /* history is a convenience */ }
}

/** The books the Wikipedia app reads: every readable Wikipedia set, the full one first (the hub already limits them to the person's age band). */
export function wikipediaBooks(books: readonly ReferenceBookView[]): ReferenceBookView[] {
  const isSimple = (book: ReferenceBookView) => book.id.startsWith("wikipedia_en_simple");
  return books.filter((book) => book.id.startsWith("wikipedia_")).sort((a, b) => Number(isSimple(a)) - Number(isSimple(b)));
}

function ExploreGrid({ book }: { book: string }) {
  const picks = useQuery({
    queryKey: ["wikipedia-explore", book],
    queryFn: async () => (await Promise.all(Array.from({ length: EXPLORE_COUNT }, () => api.referenceRandom(book).catch(() => null)))).filter((x): x is NonNullable<typeof x> => x !== null),
    staleTime: 5 * 60 * 1000, retry: false,
  });
  const unique = [...new Map((picks.data ?? []).map((item) => [item.path, item])).values()];
  return (
    <section aria-label="Explore" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Explore</h2>
      {picks.isPending ? <p role="status">Finding articles…</p> : null}
      {picks.data && !unique.length ? <p role="status">Nothing to suggest right now. Try a search.</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2">{unique.map((item) => <li key={item.path}><Link className="bg-card text-card-foreground hover:bg-muted block rounded-lg border p-3 font-semibold" to={articleRoute(item.book, item.path)}>{item.title}</Link></li>)}</ul>
    </section>
  );
}

function SavedList({ books }: { books: readonly ReferenceBookView[] }) {
  const { saves, isPending, isError, remove } = useReferenceSaves();
  const names = new Map(books.map((item) => [item.id, item.source_label]));
  return (
    <section aria-label="Saved" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Saved</h2>
      {isPending ? <p role="status">Opening your saved articles…</p> : null}
      {isError ? <p role="alert">Could not load your saved articles. Check that Home is running, then try again.</p> : null}
      {!isPending && !isError && !saves.length ? <p className="text-muted-foreground">Nothing saved yet. Open an article and press Save to keep it here.</p> : null}
      <ul className="flex flex-col gap-1">
        {saves.map((save) => (
          <li key={save.id} className="flex items-center gap-2">
            <Link className="hover:bg-muted min-w-0 flex-1 rounded-md px-2 py-1.5" to={articleRoute(save.book, save.path)}>
              <span className="font-semibold">{save.title}</span>
              {names.get(save.book) ? <span className="text-muted-foreground block text-sm">{names.get(save.book)}</span> : null}
            </Link>
            <Button variant="ghost" size="sm" aria-label={`Remove ${save.title} from Saved`} onClick={() => remove(save.id)}>Remove</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WikipediaPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useTabItem("Wikipedia");
  const booksQuery = useQuery({ queryKey: ["reference-books"], queryFn: api.referenceBooks });
  const books = useMemo(() => wikipediaBooks(booksQuery.data ?? []), [booksQuery.data]);
  const book = books[0]?.id;
  const articleMatch = location.pathname.match(/^\/wikipedia\/a\/([^/]+)\/(.+)$/);
  const articleBook = articleMatch ? decodeURIComponent(articleMatch[1]!) : undefined;
  const articlePath = articleMatch ? decodeURIComponent(articleMatch[2]!) : undefined;
  const params = new URLSearchParams(location.search);
  const q = params.get("q") ?? "";
  const section = location.pathname.startsWith("/wikipedia/explore") ? "explore" : location.pathname.startsWith("/wikipedia/saved") ? "saved" : "home";
  const [recent, setRecent] = useState<RecentArticle[]>(readRecent);
  const article = useQuery({ queryKey: ["reference-article", articleBook, articlePath], queryFn: () => api.referenceArticle(articleBook!, articlePath!), enabled: Boolean(articleBook && articlePath), retry: false });
  useEffect(() => { if (article.data && articleBook && articlePath) { remember({ book: articleBook, path: articlePath, title: article.data.title }); setRecent(readRecent()); } }, [article.data, articleBook, articlePath]);
  const random = useMutation({ mutationFn: () => api.referenceRandom(book!), onSuccess: (pick) => navigate(articleRoute(pick.book, pick.path)) });
  const search = (next: string, within?: string) => navigate(`/wikipedia/search?${new URLSearchParams({ q: next, ...(within ? { book: within } : {}) })}`);
  const onSearchPage = location.pathname.startsWith("/wikipedia/search") && q;
  const resultBook = params.get("book") ?? undefined;
  const appHome = () => navigate("/wikipedia");

  return (
    <Page title="Wikipedia" hideTitle>
      <div className="flex min-w-0 flex-1 flex-col gap-5 p-4">
        {booksQuery.isPending ? <p role="status">Opening Wikipedia…</p> : null}
        {booksQuery.isError ? <p role="alert">Could not open your library. Check that Home is running, then try again.</p> : null}
        {booksQuery.data && !book ? (
          <section className="flex flex-col gap-2" aria-label="Wikipedia is not installed">
            <h2 className="text-xl font-semibold">Wikipedia is not in your library yet</h2>
            <p className="text-muted-foreground">An owner or admin can add it in Settings, under Reference library. It downloads once and then works without the internet.</p>
          </section>
        ) : null}
        {book ? (
          <>
            <ReaderSearchBox key={`${location.pathname}${location.search}`} book={book} placeholder="Search Wikipedia" routeFor={articleRoute} onSearch={(next) => search(next)} initial={onSearchPage ? q : ""} />
            <div className="flex flex-wrap items-center gap-2" role="navigation" aria-label="Wikipedia sections">
              <Chip selected={!articleMatch && !onSearchPage && section === "home"} onClick={() => navigate("/wikipedia")}>Home</Chip>
              <Chip selected={section === "explore" && !articleMatch} onClick={() => navigate("/wikipedia/explore")}>Explore</Chip>
              <Chip selected={section === "saved" && !articleMatch} onClick={() => navigate("/wikipedia/saved")}>Saved</Chip>
              <Button variant="outline" size="sm" disabled={random.isPending} onClick={() => random.mutate()}>Random article</Button>
              {random.isError ? <span role="alert" className="text-muted-foreground text-sm">No article came back. Try once more.</span> : null}
            </div>
            {articleBook && articlePath ? <ReaderArticle book={articleBook} path={articlePath} routeFor={articleRoute} appName="Wikipedia" onAppHome={appHome} /> : null}
            {onSearchPage ? <SearchResults q={q} {...(resultBook ? { book: resultBook } : {})} books={books} routeFor={articleRoute} onBook={(next) => search(q, next)} onSearch={(next) => search(next, resultBook)} /> : null}
            {!articleMatch && !onSearchPage && section === "explore" ? <ExploreGrid book={book} /> : null}
            {!articleMatch && !onSearchPage && section === "saved" ? <SavedList books={books} /> : null}
            {!articleMatch && !onSearchPage && section === "home" ? (
              <section aria-label="Recent" className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold">Recent</h2>
                {recent.length ? <ul className="flex flex-col gap-1">{recent.map((item) => <li key={`${item.book}:${item.path}`}><Link className="hover:bg-muted block rounded-md px-2 py-1.5" to={articleRoute(item.book, item.path)}>{item.title}</Link></li>)}</ul> : <p className="text-muted-foreground">Articles you open show up here until you close this tab. Search above, or try a random article.</p>}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </Page>
  );
}
