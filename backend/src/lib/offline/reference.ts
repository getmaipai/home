import { createHash } from "node:crypto";
import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import type { PersonRow } from "@/types";
import { articlePayloadFor, loadArticleFor, readArticleImage } from "@/lib/reference/article";
import type { OfflineProvider } from "./registry";

const missing = "This article is not available to you on Home. Open the item in its app, then try again.";
type Picture = { path: string; srcs: Array<(payload: any) => void> };
function splitRecord(id: string): { book: string; path: string } | null {
  const split = id.indexOf("~");
  if (split < 1 || split === id.length - 1) return null;
  const book = id.slice(0, split); const path = id.slice(split + 1);
  if (book.includes("~") || path.split("/").includes("..") || !path) return null;
  return { book, path };
}
function imagePaths(payload: any): string[] {
  const paths: string[] = [];
  const add = (src: unknown) => {
    if (typeof src !== "string") return;
    const match = /^\/api\/reference\/media\/([^/]+)\/(.+)$/.exec(src);
    if (!match) return;
    try { const path = decodeURIComponent(match[2]!); if (!paths.includes(path)) paths.push(path); } catch { /* Ignore malformed source URLs. */ }
  };
  add(payload.lead_image?.src); add(payload.infobox?.image?.src);
  for (const block of payload.blocks ?? []) if (block?.type === "figure") add(block.src);
  for (const item of payload.related ?? []) add(item.thumbnail?.src);
  return paths;
}
function rewrittenPayload(payload: any, paths: string[], urls: string[]): any {
  const rewrite = (value: any) => {
    if (!value || typeof value.src !== "string") return value;
    const index = paths.findIndex((path) => value.src.endsWith(`/${encodeURIComponent(path)}`));
    return index < 0 ? value : { ...value, src: urls[index] };
  };
  return {
    ...payload,
    ...(payload.lead_image ? { lead_image: rewrite(payload.lead_image) } : {}),
    ...(payload.infobox ? { infobox: { ...payload.infobox, ...(payload.infobox.image ? { image: rewrite(payload.infobox.image) } : {}) } } : {}),
    blocks: (payload.blocks ?? []).map((block: any) => block.type === "figure" ? { ...block, src: rewrite({ src: block.src }).src } : block),
    ...(payload.related ? { related: payload.related.map((item: any) => item.thumbnail ? { ...item, thumbnail: rewrite(item.thumbnail) } : item) } : {}),
  };
}
async function snapshot(person: PersonRow, id: string) {
  const parsed = splitRecord(id); if (!parsed) return null;
  const loaded = await loadArticleFor(person, parsed.book, parsed.path);
  if (!loaded || "redirect" in loaded) return null;
  const payload = await articlePayloadFor(person, loaded); if (!payload) return null;
  const paths = imagePaths(payload);
  const pictures: Array<{ path: string; bytes: Uint8Array; type: string; fingerprint: string; id: string }> = [];
  for (const path of paths) {
    const image = await readArticleImage(person, parsed.book, path);
    if (!image) continue;
    const bytes = new Uint8Array(image.bytes); const fingerprint = createHash("sha256").update(bytes).digest("hex");
    pictures.push({ path, bytes, type: image.type, fingerprint, id: `i~${pictures.length}~${id}` });
  }
  const urls = pictures.map((picture) => `/api/offline/file/reference/${encodeURIComponent(picture.id)}`);
  const rewritten = rewrittenPayload(payload, pictures.map((p) => p.path), urls);
  const articleBytes = new TextEncoder().encode(JSON.stringify(rewritten));
  const articleFingerprint = createHash("sha256").update(articleBytes).digest("hex");
  const article = { id: `a~${id}`, title: payload.title, url: `/api/offline/file/reference/${encodeURIComponent(`a~${id}`)}`, bytes: articleBytes.byteLength, mime: "application/json", fingerprint: articleFingerprint, ready: true, playable: "original" as const, reason: null };
  const entries = [article, ...pictures.map((picture) => ({ id: picture.id, title: payload.title, url: `/api/offline/file/reference/${encodeURIComponent(picture.id)}`, bytes: picture.bytes.byteLength, mime: picture.type, fingerprint: picture.fingerprint, ready: true, playable: "original" as const, reason: null }))];
  return { id, payload, articleBytes, entries, pictures };
}

export const referenceOfflineProvider: OfflineProvider = {
  kind: "reference",
  // Reference applies its book list and minor floor while loading the manifest and every file.
  refuse: () => null,
  async manifest(person, id) {
    const data = await snapshot(person, id); if (!data) return null;
    return OfflineManifest.parse({ kind: "reference", id, title: data.payload.title, subtitle: data.payload.source_label, total_bytes: data.entries.reduce((sum, entry) => sum + entry.bytes, 0), generated_at: new Date().toISOString(), entries: data.entries });
  },
  async file(person, entryId) {
    const missingResponse = () => Response.json({ error: missing }, { status: 404 });
    let decoded: string;
    try { decoded = decodeURIComponent(entryId); } catch { return missingResponse(); }
    const first = decoded.indexOf("~"); if (first < 1) return missingResponse();
    const tag = decoded.slice(0, first); const rest = decoded.slice(first + 1);
    const second = rest.indexOf("~");
    if (tag === "a") {
      if (second < 0) return missingResponse();
      const data = await snapshot(person, rest); if (!data) return missingResponse();
      const bytes = data.articleBytes; const fingerprint = createHash("sha256").update(bytes).digest("hex");
      return new Response(bytes, { headers: { "Content-Type": "application/json", "ETag": JSON.stringify(fingerprint), "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (tag !== "i" || second < 0 || !/^\d+$/.test(rest.slice(0, second))) return missingResponse();
    const index = Number(rest.slice(0, second)); const recordId = rest.slice(second + 1);
    const data = await snapshot(person, recordId); if (!data) return missingResponse();
    const picture = data.pictures[index]; if (!picture || picture.id !== entryId) return missingResponse();
    return new Response(picture.bytes, { headers: { "Content-Type": picture.type, "ETag": JSON.stringify(picture.fingerprint), "Content-Length": String(picture.bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  },
};
