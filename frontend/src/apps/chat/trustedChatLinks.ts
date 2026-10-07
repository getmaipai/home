import type { ThreadMessage } from "@assistant-ui/react";
import { sourcesFromMessage } from "@/apps/chat/chatSources";
import type { MarkdownLinkContext } from "@maipai/ui/src/elements/markdown-text";

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

function cleanTypedUrl(raw: string): string {
  let url = raw.replace(/[.,!?;:]+$/, "");
  for (const [close, open] of [[")", "("], ["]", "["]] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
  }
  return url;
}

function typedUrls(message: ThreadMessage): string[] {
  if (message.role !== "user") return [];
  return message.content.flatMap((part) => {
    if (part.type !== "text") return [];
    return Array.from(part.text.matchAll(URL_RE), ([raw]) => cleanTypedUrl(raw));
  });
}

/** External reply links are trusted only when the person typed the exact URL
 * in this conversation or the current assistant message cites that URL. */
export function trustedChatLinks(message: MarkdownLinkContext["message"], messages: MarkdownLinkContext["messages"]): readonly string[] {
  return [...new Set([
    ...messages.flatMap(typedUrls),
    ...sourcesFromMessage(message).map((source) => source.url),
  ])];
}
