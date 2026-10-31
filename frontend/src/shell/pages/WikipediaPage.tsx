import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Page } from "@maipai/ui/src/primitives/Page";
import { api, type ReferenceBookView, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { ReaderArticle } from "@/shell/reader/ReaderArticle";
import { ReaderSearchBox } from "@/shell/reader/SearchBox";
import { SearchResults } from "@/shell/reader/SearchResults";
import { useReferenceSaves } from "@/shell/reader/saves";
import { ArticleCard } from "@/shell/reader/ArticleCard";
import { SectionSidebar, type SectionSidebarItem } from "@maipai/ui/src/primitives/SectionSidebar";

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

/** Random articles worth a card: the book's random pick is often a stub with no picture, so more are drawn and only those with a picture and a
 * one-line description are kept. The previews are the same ones the cards read, so they are cached for the cards. */
function useRandomPicks(book: string, count: number, key: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["wikipedia-picks", book, key],
    queryFn: async () => {
      const drawn = (await Promise.all(Array.from({ length: count * 4 }, () => api.referenceRandom(book).catch(() => null)))).filter((x): x is NonNullable<typeof x> => x !== null);
      const unique = [...new Map(drawn.map((item) => [item.path, item])).values()];
      const checked = await Promise.all(unique.map(async (item) => {
        const preview = await queryClient.fetchQuery({ queryKey: ["reference-preview", item.book, item.path], queryFn: () => api.referencePreview(item.book, item.path), staleTime: 10 * 60 * 1000 }).catch(() => null);
        return preview?.thumbnail && preview.description ? item : null;
      }));
      const good = checked.filter((x): x is NonNullable<typeof x> => x !== null);
      return (good.length >= count ? good : [...good, ...unique.filter((item) => !good.includes(item))]).slice(0, count);
    },
    staleTime: Infinity, retry: false,
  });
}

function PickGrid({ picks, empty }: { picks: ReturnType<typeof useRandomPicks>; empty: string }) {
  const unique = picks.data ?? [];
  return (
    <>
      {picks.isPending ? <p role="status">Finding articles…</p> : null}
      {picks.data && !unique.length ? <p role="status">{empty}</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">{unique.map((item) => <li key={item.path} className="min-w-0"><ArticleCard book={item.book} path={item.path} title={item.title} to={articleRoute(item.book, item.path)} /></li>)}</ul>
    </>
  );
}

function ExploreGrid({ book }: { book: string }) {
  const [round, setRound] = useState(0);
  const picks = useRandomPicks(book, EXPLORE_COUNT, `explore-${round}`);
  return (
    <section aria-label="Explore" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Explore</h2>
        <Button variant="outline" size="sm" disabled={picks.isFetching} onClick={() => setRound((now) => now + 1)}>Show different articles</Button>
      </div>
      <p className="text-muted-foreground text-sm">Articles picked at random from the Wikipedia on this computer.</p>
      <PickGrid picks={picks} empty="Nothing to suggest right now. Try a search." />
    </section>
  );
}

function SavedList() {
  const { saves, isPending, isError, remove } = useReferenceSaves();
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section aria-label="Saved" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Saved</h2>
      {isPending ? <p role="status">Opening your saved articles…</p> : null}
      {isError ? <p role="alert">Could not load your saved articles. Check that Home is running, then try again.</p> : null}
      {!isPending && !isError && !saves.length ? <p className="text-muted-foreground">Nothing saved yet. Open an article and press Save to keep it here.</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {saves.map((save) => (
          <li key={save.id} className="min-w-0">
            <ArticleCard book={save.book} path={save.path} title={save.title} to={articleRoute(save.book, save.path)}
              action={confirming === save.id ? <DestructiveConfirm message={`Remove “${save.title}” from Saved?`} confirmLabel="Remove" busyLabel="Removing…" onConfirm={() => { remove(save.id); setConfirming(null); }} onCancel={() => setConfirming(null)} /> : <Button variant="destructive" size="sm" aria-label={`Remove ${save.title} from Saved`} onClick={() => setConfirming(save.id)}>Remove</Button>} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HomeSections({ book, recent }: { book: string; recent: RecentArticle[] }) {
  const [round, setRound] = useState(0);
  const picks = useRandomPicks(book, 4, `home-${round}`);
  return (
    <div className="flex flex-col gap-8">
      {recent.length ? (
        <section aria-label="Continue reading" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Continue reading</h2>
          <ul className="grid gap-3 lg:grid-cols-2">{recent.slice(0, 4).map((item) => <li key={`${item.book}:${item.path}`} className="min-w-0"><ArticleCard book={item.book} path={item.path} title={item.title} to={articleRoute(item.book, item.path)} /></li>)}</ul>
        </section>
      ) : null}
      <section aria-label="Something to read" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Something to read</h2>
          <Button variant="outline" size="sm" disabled={picks.isFetching} onClick={() => setRound((now) => now + 1)}>Show different articles</Button>
        </div>
        <PickGrid picks={picks} empty="Nothing to suggest right now. Try a search." />
      </section>
      <p className="text-muted-foreground text-xs">Text from Wikipedia under CC BY-SA 4.0, kept on this computer. Pictures keep their own licences, shown on Wikipedia.</p>
    </div>
  );
}

export function WikipediaPage({ person }: { person?: Roster } = {}) {
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
  const section = location.pathname.startsWith("/wikipedia/explore") ? "explore" : location.pathname.startsWith("/wikipedia/saved") ? "saved" : location.pathname.startsWith("/wikipedia/offline") ? "offline" : "home";
  const [recent, setRecent] = useState<RecentArticle[]>(readRecent);
  const article = useQuery({ queryKey: ["reference-article", articleBook, articlePath], queryFn: () => api.referenceArticle(articleBook!, articlePath!), enabled: Boolean(articleBook && articlePath), retry: false });
  useEffect(() => { if (article.data && articleBook && articlePath) { remember({ book: articleBook, path: articlePath, title: article.data.title }); setRecent(readRecent()); } }, [article.data, articleBook, articlePath]);
  const random = useMutation({ mutationFn: () => api.referenceRandom(book!), onSuccess: (pick) => navigate(articleRoute(pick.book, pick.path)) });
  const search = (next: string, within?: string) => navigate(`/wikipedia/search?${new URLSearchParams({ q: next, ...(within ? { book: within } : {}) })}`);
  const onSearchPage = location.pathname.startsWith("/wikipedia/search") && q;
  const resultBook = params.get("book") ?? undefined;
  const appHome = () => navigate("/wikipedia");
  const atSection = !articleMatch && !onSearchPage;
  const go = (to: string) => (event: { preventDefault: () => void }) => { event.preventDefault(); navigate(to); };
  const sectionItems: SectionSidebarItem[] = [
    { id: "home", label: "Home", icon: "home", href: "/wikipedia", active: atSection && section === "home", onClick: go("/wikipedia") },
    { id: "explore", label: "Explore", icon: "globe", href: "/wikipedia/explore", active: atSection && section === "explore", onClick: go("/wikipedia/explore") },
    { id: "saved", label: "Saved", icon: "bookmark", href: "/wikipedia/saved", active: atSection && section === "saved", onClick: go("/wikipedia/saved") },
    ...(book ? [{ id: "random", label: "Random article", icon: "sparkles", onClick: (event: { preventDefault: () => void }) => { event.preventDefault(); random.mutate(); } }] : []),
  ];

  return (
    <Page title="Wikipedia" hideTitle>
      <div className="flex min-h-0 flex-1" data-workspace-fill="">
      <SectionSidebar standalone density="compact" groups={[{ id: "wikipedia-sections", items: sectionItems }]} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {booksQuery.isPending ? <p role="status">Opening Wikipedia…</p> : null}
        {booksQuery.isError ? <p role="alert">Could not open your library. Check that Home is running, then try again.</p> : null}
        {booksQuery.data && !book ? (
          <section className="flex flex-col gap-2" aria-label="Wikipedia is not installed">
            <h2 className="text-xl font-semibold">Wikipedia is not in your library yet</h2>
            <p className="text-muted-foreground">An owner or admin can download it in Settings, Offline data (pick Minimum, Moderate or Full, or switch single books on). It downloads once and then works without the internet.</p>
            <Link className="underline underline-offset-2" to="/settings/offline-data">Open Offline data</Link>
          </section>
        ) : null}
        {book ? (
          <>
            <ReaderSearchBox key={`${location.pathname}${location.search}`} book={book} placeholder="Search Wikipedia" routeFor={articleRoute} onSearch={(next) => search(next)} initial={onSearchPage ? q : ""} />
            <div className="flex flex-wrap items-center gap-2 lg:hidden" role="navigation" aria-label="Wikipedia sections">
              <Chip selected={!articleMatch && !onSearchPage && section === "home"} onClick={() => navigate("/wikipedia")}>Home</Chip>
              <Chip selected={section === "explore" && !articleMatch} onClick={() => navigate("/wikipedia/explore")}>Explore</Chip>
              <Chip selected={section === "saved" && !articleMatch} onClick={() => navigate("/wikipedia/saved")}>Saved</Chip>
              <Button variant="outline" size="sm" disabled={random.isPending} onClick={() => random.mutate()}>Random article</Button>
              {random.isError ? <span role="alert" className="text-muted-foreground text-sm">No article came back. Try once more.</span> : null}
            </div>
            {articleBook && articlePath ? <ReaderArticle book={articleBook} path={articlePath} routeFor={articleRoute} appName="Wikipedia" canDiscuss={!!person && person.age_band !== "child"} onAppHome={appHome} onSearch={(next) => search(next)} /> : null}
            {onSearchPage ? <SearchResults q={q} {...(resultBook ? { book: resultBook } : {})} books={books} routeFor={articleRoute} onBook={(next) => search(q, next)} onSearch={(next) => search(next, resultBook)} /> : null}
            {!articleMatch && !onSearchPage && section === "explore" ? <ExploreGrid book={book} /> : null}
            {!articleMatch && !onSearchPage && section === "saved" ? <SavedList /> : null}
            {!articleMatch && !onSearchPage && section === "home" ? <HomeSections book={book} recent={recent} /> : null}
          </>
        ) : null}
      </div>
      </div>
    </Page>
  );
}
