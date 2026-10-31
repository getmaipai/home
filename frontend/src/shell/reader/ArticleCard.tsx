import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";

const ChevronRight = getIcon("chevron-right");
const PREVIEW_STALE_MS = 10 * 60 * 1000;

/** True once the element has come near the screen; a browser without IntersectionObserver counts as seen at once. */
export function useSeen(): [React.RefObject<HTMLDivElement | null>, boolean] {
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

/** The picture, description, category and first lines of an article, read from the book once the card is on screen. */
export function useArticlePreview(book: string, path: string, enabled: boolean) {
  return useQuery({ queryKey: ["reference-preview", book, path], queryFn: () => api.referencePreview(book, path), enabled, staleTime: PREVIEW_STALE_MS, retry: false });
}

export interface ArticleCardProps {
  book: string;
  path: string;
  title: string;
  /** The search engine's own snippet, shown before the preview's lead arrives and preferred when it has words. */
  snippet?: string;
  /** Where the card goes. Omit when the card is drawn inside something that already links (a result list item). */
  to?: string;
  /** "card" is the large picture card of the search page, Explore and Saved; "row" is the compact type-ahead row. */
  variant?: "card" | "row";
  /** Called when the card is followed (the type-ahead closes itself with it). */
  onOpen?: () => void;
  /** A control at the card's end instead of the chevron (Remove on a Saved article). */
  action?: ReactNode;
}

/** One article as a picture, name and metadata: the same look in search results, type-ahead, Explore, Home and Saved. */
export function ArticleCard({ book, path, title, snippet, to, variant = "card", action, onOpen }: ArticleCardProps) {
  const [ref, seen] = useSeen();
  const preview = useArticlePreview(book, path, seen);
  const data = preview.data;
  const row = variant === "row";
  const size = row ? "size-10 rounded-md" : "h-28 w-24 rounded-lg sm:h-32 sm:w-28";
  const picture = data?.thumbnail
    ? <img src={data.thumbnail.src} alt="" loading="lazy" className={`${size} shrink-0 object-cover`} />
    : preview.isPending && seen ? <div aria-hidden className={`${size} bg-muted shrink-0`} /> : row ? <div aria-hidden className={`${size} bg-muted shrink-0`} /> : null;
  const lines = snippet || data?.lead || data?.summary;
  const body = (
    <div ref={ref} data-slot="reader-result" className={row ? "flex w-full min-w-0 items-center gap-3 px-3 py-2" : "bg-card flex w-full min-w-0 items-center gap-4 rounded-xl border p-3"}>
      {picture}
      <div className="min-w-0 flex-1">
        <p className={row ? "truncate font-semibold" : "text-lg font-semibold"}>{title}</p>
        {data?.description ? <p className={row ? "text-muted-foreground truncate text-sm" : "text-muted-foreground text-sm"}>{data.description}</p> : null}
        {!row && data?.kicker ? <div className="my-1.5"><Chip>{data.kicker}</Chip></div> : null}
        {!row && lines ? <p className="text-muted-foreground line-clamp-2 break-words text-sm">{lines}</p> : null}
      </div>
      {action && !to ? action : !action && !row ? <ChevronRight aria-hidden className="text-muted-foreground size-5 shrink-0" /> : null}
    </div>
  );
  if (!to) return body;
  const link = <Link to={to} onClick={onOpen} className="block min-w-0 flex-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>;
  return action ? <div className="flex min-w-0 items-center gap-2">{link}{action}</div> : link;
}
