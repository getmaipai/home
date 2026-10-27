// NEWS-04: the Discuss button on an open article. The news-story page's `discuss` action lands here with the story id;
// this reads the article the way the reader does (the hub's own copy for this person, so a child's gate and a teen's
// links hold), writes one chat message and hands it to the chat's `?ask=` entry, which sends it at once.
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { ArticleBlockData, ArticleInlineData } from "@maipai/ui/src/primitives/ArticleView";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { api } from "@/lib/api";
import type { Roster } from "@/lib/api";

export const DISCUSS_PROMPT = "Read this article and tell me what you think, including anything that looks one-sided or missing.";
/** Long enough for a full feature, short of a whole page of chat history. */
export const DISCUSS_MAX_CHARS = 8000;

const inlineText = (inlines: ArticleInlineData[]): string => inlines.map((inline) => inline.text).join("");

/** The words of one article block, or "" for a block with none (a picture). */
export function blockText(block: ArticleBlockData): string {
  switch (block.type) {
    case "heading": return block.text;
    case "paragraph": return inlineText(block.inlines);
    case "quote": return inlineText(block.inlines);
    case "list": return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${inlineText(item)}`).join("\n");
    case "note": return block.text;
    case "rows": return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "table": return [block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
    default: return "";
  }
}

export type DiscussStory = { title: string; byline?: { publisher: string }; blocks: ArticleBlockData[] };

/** The chat message: the ask, then the headline, the outlet and the article text (cut at a paragraph near the limit). */
export function discussMessage(story: DiscussStory): string {
  const parts: string[] = [];
  let used = 0;
  for (const block of story.blocks) {
    const text = blockText(block).trim();
    if (!text) continue;
    if (used + text.length > DISCUSS_MAX_CHARS && parts.length > 0) break;
    parts.push(text);
    used += text.length;
  }
  const source = story.byline?.publisher ? ` (${story.byline.publisher})` : "";
  return `${DISCUSS_PROMPT}\n\n${story.title}${source}\n\n${parts.join("\n\n")}`;
}

export function NewsDiscussPage({ person }: { person: Roster }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as { pageState?: { id?: unknown } } | null)?.pageState;
  const id = typeof state?.id === "string" ? state.id : "";
  const [ask, setAsk] = useState<string | null | undefined>(undefined);
  const child = person.age_band === "child";
  useEffect(() => {
    if (!id || child) return;
    let live = true;
    api.appData<Array<{ props?: DiscussStory }> | { blocks?: Array<{ props?: DiscussStory }> }>("news", "story", { id }).then(
      (body) => {
        const blocks = Array.isArray(body) ? body : body.blocks ?? [];
        const story = blocks[0]?.props;
        if (live) setAsk(story && story.blocks?.length ? discussMessage(story) : null);
      },
      () => live && setAsk(null),
    );
    return () => { live = false; };
  }, [id, child]);
  if (ask) return <Navigate to={`/chat?ask=${encodeURIComponent(ask)}`} replace />;
  const message = child
    ? "Discuss is for teens and adults. Ask a grown-up to read this one with you."
    : !id || ask === null
      ? "This story is not available to discuss. Go back and open it again."
      : null;
  return <EmptyState icon="newspaper" text={message ?? "Opening a chat about this story."} actionLabel={message ? "Back to News" : undefined} onAction={message ? () => navigate("/apps/news") : undefined} />;
}
