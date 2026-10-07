import type { SourceMessagePart, ThreadMessage } from "@assistant-ui/react";
import type { Source as SpecSource } from "@maipai/spec/gen/ts/source.js";

export interface ChatSource {
  domain: string;
  title: string;
  url: string;
}

/** Convert persisted/streamed web sources to assistant-ui's native source parts. */
export function sourceMessageParts(sources: readonly SpecSource[] | undefined): SourceMessagePart[] {
  return (sources ?? []).map((source) => ({
    type: "source",
    sourceType: "url",
    id: source.id,
    url: source.url,
    title: source.title,
  }));
}

const EMPTY_SOURCES: ChatSource[] = [];
const sourceCache = new WeakMap<object, ChatSource[]>();

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Sources stay in their native message parts; preserve their array order for [n] citations. */
export function sourcesFromMessage(message: ThreadMessage | undefined): ChatSource[] {
  const parts = message?.content;
  if (!parts) return EMPTY_SOURCES;
  const key = parts as object;
  const cached = sourceCache.get(key);
  if (cached) return cached;
  const sources = parts.flatMap((part) => {
    if (part.type !== "source" || part.sourceType !== "url" || !part.url) return [];
    const domain = sourceDomain(part.url);
    return [{ domain, title: part.title || domain, url: part.url }];
  });
  sourceCache.set(key, sources);
  return sources;
}
