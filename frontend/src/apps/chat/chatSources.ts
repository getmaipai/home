import type { SourceMessagePart, ThreadMessage } from "@assistant-ui/react";
import type { Source as SpecSource } from "@maipai/spec/gen/ts/source.js";
import { licenceLabel } from "@maipai/home-backend/src/lib/retrieval/referenceLicences";

export interface ChatSource {
  domain: string;
  title: string;
  url: string;
  /** KS-02F: the licence line of a library page ("CC BY-SA 4.0, snapshot 2026-09-01"); the kit shows it under the title. */
  detail?: string;
}

const META_KEY = "maipai";

/** KS-02F: the line under a library page, "CC BY-SA 4.0, snapshot 2026-09-01".
 * The label comes from the backend's one licence map (referenceSources.ts);
 * there is no copy of it here. Null for a source with no licence. */
function licenceLine(source: SpecSource): string | null {
  if (!source.licence) return null;
  const label = licenceLabel(source.licence);
  return source.snapshot_date ? `${label}, snapshot ${source.snapshot_date}` : label;
}

/** Convert persisted/streamed sources to assistant-ui's native source parts.
 * A library page (kind "reference" with a `local_path`) carries the Home proxy
 * path as its `url`, so the citation chip opens the page inside the home and
 * never the public site (a minor must not leave the home). The public page's
 * host and the licence line ride in `providerMetadata` for the Sources footer. */
export function sourceMessageParts(sources: readonly SpecSource[] | undefined): SourceMessagePart[] {
  return (sources ?? []).map((source) => {
    const local = source.kind === "reference" && source.local_path ? source.local_path : null;
    const line = local ? licenceLine(source) : null;
    return {
      type: "source",
      sourceType: "url",
      id: source.id,
      url: local ?? source.url,
      title: source.title,
      ...(local ? { providerMetadata: { [META_KEY]: { domain: sourceDomain(source.url), ...(line ? { licence: line } : {}) } } } : {}),
    };
  });
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
    const meta = part.providerMetadata?.[META_KEY] as { domain?: string; licence?: string } | undefined;
    const host = meta?.domain ?? sourceDomain(part.url);
    return [{ domain: host, title: part.title || host, url: part.url, ...(meta?.licence ? { detail: meta.licence } : {}) }];
  });
  sourceCache.set(key, sources);
  return sources;
}
