import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArticleSpeechContext, ArticleView, type ArticleAction, type ArticlePreview } from "@maipai/ui/src/primitives/ArticleView";
import { api, ApiError, type ReferenceArticleView } from "@/lib/api";
import { toArticleViewData } from "./articleData";
import { Button } from "@maipai/ui/src/ui/button";
import { useReferenceSaves } from "./saves";
import { readKeptArticle, useKeptArticles } from "./offline";
import { speakableParagraphs, useArticleListen } from "./useArticleListen";

const ARTICLE_ACTIONS: ArticleAction[] = ["save", "listen"];
const PREVIEW_STALE_MS = 10 * 60 * 1000;

export interface ReaderArticleProps {
  book: string;
  path: string;
  /** Where an article lives in the app that draws this reader (Reference and Wikipedia each have their own route). */
  routeFor: (book: string, path: string) => string;
  appName: string;
  onAppHome: () => void;
  /** Drawn in the loading and unavailable states, so each app keeps its own words. */
  unavailable?: ReactNode;
}

/** READER-03: one article, drawn by the kit reader with link previews; used by Reference and by the Wikipedia app. */
export function ReaderArticle({ book, path, routeFor, appName, onAppHome, unavailable }: ReaderArticleProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const saves = useReferenceSaves();
  const query = useQuery<ReferenceArticleView>({ queryKey: ["reference-article", book, path], queryFn: async () => {
    try { return await api.referenceArticle(book, path); } catch (error) {
      // The hub does not answer (an ApiError means it did): read the copy kept on this device, if there is one.
      if (error instanceof ApiError) throw error;
      const kept = await readKeptArticle(book, path);
      if (kept) return kept;
      throw error;
    }
  }, retry: false });
  const keptArticles = useKeptArticles();
  const reading = useArticleListen();
  const storyId = `${book}/${path}`;
  const [keepMessage, setKeepMessage] = useState<string | null>(null);
  const loadPreview = useCallback(async (target: { book: string; path: string }): Promise<ArticlePreview | null> => {
    try {
      const preview = await queryClient.fetchQuery({ queryKey: ["reference-preview", target.book, target.path], queryFn: () => api.referencePreview(target.book, target.path), staleTime: PREVIEW_STALE_MS });
      return { title: preview.title, summary: preview.description ?? preview.summary, ...(preview.thumbnail ? { thumbnail: preview.thumbnail } : {}) };
    } catch { return null; }
  }, [queryClient]);
  if (query.isPending) return <p role="status">Loading article…</p>;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <>{unavailable ?? <p role="status">This article is not available.</p>}</>;
    return <p role="alert">Could not load this article.</p>;
  }
  const article = query.data;
  return (
    <div id="reference-article" data-touch-target-exempt className="min-w-0">
      <ArticleSpeechContext.Provider value={reading.speech}>
      <ArticleView
        data={{ ...toArticleViewData(article, { appName, onAppHome }), saved: saves.isSaved(book, path) }}
        available={ARTICLE_ACTIONS}
        ids={{ story_id: storyId }}
        onAction={(action, ids) => {
          if (action === "save") saves.setSaved(book, path, ids.on !== false);
          if (action === "listen") reading.listen(storyId, speakableParagraphs(article));
        }}
        onBack={() => navigate(-1)}
        loadPreview={loadPreview}
        renderTargetLink={(target, text) => <Link className="underline underline-offset-2" to={routeFor(target.book, target.path)}>{text}</Link>}
        footer={<>{article.licence} · Snapshot {article.snapshot_date ?? "date unavailable"}</>}
      />
      </ArticleSpeechContext.Provider>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {keptArticles.isKept(book, path)
          ? <Button variant="outline" size="sm" onClick={() => { setKeepMessage(null); void keptArticles.remove(book, path); }}>Remove from this device</Button>
          : <Button variant="outline" size="sm" onClick={async () => { setKeepMessage(null); const result = await keptArticles.keep(book, path); if (!result.ok) setKeepMessage(result.message); }}>Keep on this device</Button>}
        {keepMessage ? <p role="alert" className="text-muted-foreground text-sm">{keepMessage}</p> : null}
      </div>
    </div>
  );
}
