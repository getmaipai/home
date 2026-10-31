import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArticleSpeechContext, ArticleView, type ArticleAction, type ArticlePreview } from "@maipai/ui/src/primitives/ArticleView";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { api, ApiError, type ReferenceArticleView } from "@/lib/api";
import { toArticleViewData } from "./articleData";
import { useReferenceSaves } from "./saves";
import { readKeptArticle } from "./offline";
import { speakableParagraphs, useArticleListen } from "./useArticleListen";

const ARTICLE_ACTIONS: ArticleAction[] = ["save", "listen", "summarize"];
const DISCUSS_PROMPT = "I'd like to talk about this article.";
/** The chat's `read_item` reference for an article: the book and path as one URL-safe token (the hub decodes it under the person's own age band). */
export function discussMessage(book: string, path: string): string {
  const bytes = new TextEncoder().encode(`${book}/${path}`);
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${DISCUSS_PROMPT}\n\nmaipai://reference/article/${id}`;
}
const MAX_REF_ID = 80;
const PREVIEW_STALE_MS = 10 * 60 * 1000;

export interface ReaderArticleProps {
  book: string;
  path: string;
  /** Where an article lives in the app that draws this reader (Reference and Wikipedia each have their own route). */
  routeFor: (book: string, path: string) => string;
  appName: string;
  /** Teens and adults can talk about the article with the assistant; a child's page leaves this off. */
  canDiscuss?: boolean;
  onAppHome: () => void;
  /** Runs a search in the app that draws this reader (the category crumb uses it). */
  onSearch?: (q: string) => void;
  /** Drawn in the loading and unavailable states, so each app keeps its own words. */
  unavailable?: ReactNode;
}

/** READER-03: one article, drawn by the kit reader with link previews; used by Reference and by the Wikipedia app. */
export function ReaderArticle({ book, path, routeFor, appName, canDiscuss, onAppHome, onSearch, unavailable }: ReaderArticleProps) {
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
  const reading = useArticleListen();
  const storyId = `${book}/${path}`;
  const loadPreview = useCallback(async (target: { book: string; path: string }): Promise<ArticlePreview | null> => {
    try {
      const preview = await queryClient.fetchQuery({ queryKey: ["reference-preview", target.book, target.path], queryFn: () => api.referencePreview(target.book, target.path), staleTime: PREVIEW_STALE_MS });
      return { title: preview.title, summary: preview.description ?? preview.summary, ...(preview.thumbnail ? { thumbnail: preview.thumbnail } : {}) };
    } catch { return null; }
  }, [queryClient]);
  // Key points write themselves on the hub: the reader asks again quietly until they arrive. A new article starts empty.
  const [keyPoints, setKeyPoints] = useState<{ key: string; value: { text: string; band: "child" | "teen" | "adult" } } | null>(null);
  const askKeyPoints = useCallback(async () => {
    try {
      const { key_points } = await api.referenceKeyPoints(book, path);
      if (key_points) setKeyPoints({ key: storyId, value: key_points });
    } catch { /* not ready or not available: the article stays readable */ }
  }, [book, path, storyId]);
  useEffect(() => { setKeyPoints(null); }, [storyId]);
  const discussable = canDiscuss === true && discussMessage(book, path).split("/").pop()!.length <= MAX_REF_ID;
  const available: ArticleAction[] = discussable ? [...ARTICLE_ACTIONS, "discuss"] : ARTICLE_ACTIONS;
  if (query.isPending) return <RouteSkeleton label="Loading article" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <>{unavailable ?? <p role="status">This article is not available.</p>}</>;
    return <p role="alert">Could not load this article.</p>;
  }
  const article = query.data;
  return (
    <div id="reference-article" data-touch-target-exempt className="min-w-0">
      <ArticleSpeechContext.Provider value={reading.speech}>
      <ArticleView
        data={{ ...toArticleViewData(article, { appName, onAppHome, ...(onSearch ? { onCategory: onSearch } : {}) }), saved: saves.isSaved(book, path), ...(keyPoints?.key === storyId ? { key_points: keyPoints.value } : {}) }}
        available={available}
        ids={{ story_id: storyId }}
        onAction={(action, ids) => {
          if (action === "save") saves.setSaved(book, path, ids.on !== false);
          if (action === "summarize") void askKeyPoints();
          if (action === "discuss") navigate(`/chat?ask=${encodeURIComponent(discussMessage(book, path))}`);
          if (action === "listen") reading.listen(storyId, speakableParagraphs(article));
        }}
        onBack={() => navigate(-1)}
        loadPreview={loadPreview}
        renderTargetLink={(target, text) => <Link className="underline underline-offset-2" to={routeFor(target.book, target.path)}>{text}</Link>}
      />
      </ArticleSpeechContext.Provider>
    </div>
  );
}
