import { useCallback, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArticleView, type ArticlePreview } from "@maipai/ui/src/primitives/ArticleView";
import { api, ApiError, type ReferenceArticleView } from "@/lib/api";
import { toArticleViewData } from "./articleData";

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
  const query = useQuery<ReferenceArticleView>({ queryKey: ["reference-article", book, path], queryFn: () => api.referenceArticle(book, path), retry: false });
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
      <ArticleView
        data={toArticleViewData(article, { appName, onAppHome })}
        onBack={() => navigate(-1)}
        loadPreview={loadPreview}
        renderTargetLink={(target, text) => <Link className="underline underline-offset-2" to={routeFor(target.book, target.path)}>{text}</Link>}
        footer={<>{article.licence} · Snapshot {article.snapshot_date ?? "date unavailable"}</>}
      />
    </div>
  );
}
