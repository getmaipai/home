// NEWS-04: the Discuss button on an open article. The news-story page's `discuss` action lands here with the story id;
// this writes one short chat message (the ask plus the story's maipai:// reference) and hands it to the chat's `?ask=` entry.
// The chat's read_item tool reads the article on the hub under the person's own band.
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { ArticleBlockData, ArticleInlineData } from "@maipai/ui/src/primitives/ArticleView";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import type { Roster } from "@/lib/api";

export const DISCUSS_PROMPT = "Read this article and tell me what you think, including anything that looks one-sided or missing.";

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

/** The chat message: the ask and the story's reference. The chat's read_item tool fetches the article, so no article text is pasted into the thread. */
export function discussMessage(storyId: string): string {
  return `${DISCUSS_PROMPT}\n\nmaipai://news/story/${storyId}`;
}

export function NewsDiscussPage({ person }: { person: Roster }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as { pageState?: { id?: unknown } } | null)?.pageState;
  const id = typeof state?.id === "string" ? state.id : "";
  const child = person.age_band === "child";
  if (id && !child) return <Navigate to={`/chat?ask=${encodeURIComponent(discussMessage(id))}`} replace />;
  const message = child
    ? "Discuss is for teens and adults. Ask a grown-up to read this one with you."
    : "This story is not available to discuss. Go back and open it again.";
  return <EmptyState icon="newspaper" text={message} actionLabel="Back to News" onAction={() => navigate("/apps/news")} />;
}
