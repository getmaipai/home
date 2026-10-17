import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import { decidePlayable } from "@/lib/media/kinds";
import { extensionOf } from "@/lib/media/parsers/text";
import { readableItem } from "@/lib/media/access";
import { itemByteMetadata, serveItemArtwork, serveItemBytes } from "@/lib/media/serve";
import { getProgress } from "@/lib/media/progress";
import { readAttachment } from "@/lib/attachments";
import type { MediaItem } from "@/lib/media/model";
import type { PersonRow } from "@/types";
import { mediaTimeUpRefusal, minorMayKeepOffline } from "@/lib/media/watchTime";
import type { OfflineProvider } from "./registry";
export const matches = (item: MediaItem | null, kind: string): item is MediaItem => item !== null && (kind === "media" || kind === item.kind);

// A probed row already carries this decision. Reuse the same rule for a row whose codecs arrived before its decision.
export function playableItem(item: MediaItem | null): MediaItem | null {
  if (!item || item.playable !== "unknown" || (!item.video_codec && !item.audio_codec)) return item;
  const location = item.location as { path?: string };
  return { ...item, playable: decidePlayable({ ext: extensionOf(location.path ?? ""), hasVideo: item.video_codec !== null, hasAudio: item.audio_codec !== null, videoCodec: item.video_codec, audioCodec: item.audio_codec }) };
}

/** MEDIA-KID-01: keeping media is refused for a minor whose time is up, and for any minor with a daily media budget (offline
 * time cannot be metered). Neither code is `device_revoked`, so the browser keeps its existing copies. Checked by the media
 * routes and by the generic provider, so no path keeps media around it. */
export function keepRefusal(actor: PersonRow): { error: string; code: "media_time_up" | "budget_keep_refused" } | null {
  const timeUp = mediaTimeUpRefusal(actor);
  if (timeUp) return timeUp;
  if (!minorMayKeepOffline(actor)) return { error: "Keeping a title for later is off while you have screen time limits. Ask a grown-up.", code: "budget_keep_refused" };
  return null;
}

const SUBTITLE_TYPES = new Set(["text/vtt", "text/plain", "application/x-subrip", "text/srt"]);
export const missing = "This item is not available to you on Home. Check your library, then try again.";

export function mediaManifest(actor: PersonRow, id: string): OfflineManifest | null {
  const item = playableItem(readableItem(actor, id));
  if (!item) return null;
  const metadata = itemByteMetadata(actor, item);
  const ready = metadata !== null && item.fingerprint !== null && item.playable === "original";
  const reason = !metadata || !item.fingerprint ? "notOnServer" : item.playable === "none" ? "notPlayable" : ready ? null : "notReady";
  const progress = getProgress(actor.id, id);
  const bytes = metadata?.size ?? item.size ?? 0;
  return OfflineManifest.parse({
    kind: "media", id, title: item.title, subtitle: item.subtitle, total_bytes: bytes, generated_at: new Date().toISOString(),
    entries: [{
      id, title: item.title, url: `/api/media/offline/file/media/${encodeURIComponent(id)}`, bytes, mime: item.media_type,
      fingerprint: item.fingerprint ?? "unavailable", ready, playable: item.playable, reason, duration_s: item.duration_s,
      artwork_url: item.artwork ? `/api/media/offline/file/artwork/${id}` : null,
      chapters: item.chapters.map(({ start_s, title }) => ({ start_s, title })),
      subtitles: item.subtitles.map(({ lang, label }, index) => ({ lang, label, url: `/api/media/offline/file/subtitle/${id}?track=${index}` })),
      progress: progress && "seconds" in progress.position ? { position_s: progress.position.seconds, completed: progress.completed } : null,
    }],
  });
}

/** Asset ids keep the provider kind distinct from the media asset kind. */
export async function mediaFile(actor: PersonRow, id: string, kind: string, request: Request): Promise<Response> {
  const item = playableItem(readableItem(actor, id));
  if (!item || (!["artwork", "subtitle"].includes(kind) && !matches(item, kind))) return Response.json({ error: missing }, { status: 404 });
  if (kind === "artwork") {
    const response = await serveItemArtwork(actor, item);
    if (!(response instanceof Response)) return Response.json({ error: "This picture is not available. Try keeping the item again later." }, { status: response.status });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (kind === "subtitle") {
    const raw = new URL(request.url).searchParams.get("track") ?? "0";
    const track = /^\d{1,3}$/.test(raw) ? item.subtitles[Number(raw)] : undefined;
    const read = track ? readAttachment(actor, track.file_id) : null;
    if (!read?.ok) return Response.json({ error: "This subtitle is not available. Try keeping the item again later." }, { status: 404 });
    // Only caption types are served, always as text/vtt, sandboxed: a stored file can never run as a page or script.
    if (!SUBTITLE_TYPES.has(read.value.record.media_type.split(";")[0]!.trim().toLowerCase())) return Response.json({ error: "This subtitle is not available. Try keeping the item again later." }, { status: 404 });
    return new Response(read.value.bytes as never, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  }
  if (item.playable === "none") return Response.json({ error: "This file cannot play on this device. Choose another item." }, { status: 409 });
  if (item.playable !== "original") {
    return Response.json({ error: "This copy is not ready. Try again later; files that need conversion are not supported yet." }, { status: 503, headers: { "Retry-After": "60" } });
  }
  const metadata = itemByteMetadata(actor, item);
  if (!metadata || !item.fingerprint) return Response.json({ error: "This file is not saved on Home. Check its library folder, then try again." }, { status: 404 });
  // JSON's string escaping also prevents a malformed stored fingerprint from becoming a header injection.
  const etag = JSON.stringify(item.fingerprint);
  const modified = metadata.modified.toUTCString();
  const ifRange = request.headers.get("if-range") ?? undefined;
  const dateMatches = ifRange !== undefined && !ifRange.startsWith('"') && !ifRange.startsWith("W/") && Number.isFinite(Date.parse(ifRange)) && Math.floor(metadata.modified.getTime() / 1000) === Math.floor(Date.parse(ifRange) / 1000);
  const range = !ifRange || ifRange === etag || dateMatches ? request.headers.get("range") ?? undefined : undefined;
  const response = await serveItemBytes(actor, item, range);
  if (!(response instanceof Response)) return Response.json({ error: "This file could not be read. Check its library folder, then try again." }, { status: response.status });
  response.headers.set("ETag", etag);
  response.headers.set("Last-Modified", modified);
  return response;
}

export const mediaOfflineProvider: OfflineProvider = {
  kind: "media",
  refuse: keepRefusal,
  manifest(actor, id) {
    const manifest = mediaManifest(actor, id);
    return manifest ? genericMediaManifest(manifest) : null;
  },
  file(actor, entry, request) {
    const split = entry.indexOf(":");
    const kind = split < 0 ? "media" : entry.slice(0, split);
    const id = split < 0 ? entry : entry.slice(split + 1);
    if (!["media", "artwork", "subtitle"].includes(kind)) return Promise.resolve(Response.json({ error: missing }, { status: 404 }));
    return mediaFile(actor, id, kind, request);
  },
};

/** The legacy wire stays stable for Go; generic clients use their scoped file endpoint. */
export function genericMediaManifest(manifest: OfflineManifest): OfflineManifest {
  const url = (path: string) => path.replace(/\/api\/media\/offline\/file\/(media|artwork|subtitle)\/([^?]+)/, (_, asset: string, id: string) =>
    `/api/offline/file/media/${asset === "media" ? id : encodeURIComponent(`${asset}:${id}`)}`);
  return { ...manifest, entries: manifest.entries.map((entry) => ({ ...entry, url: url(entry.url), artwork_url: entry.artwork_url ? url(entry.artwork_url) : null, subtitles: entry.subtitles.map((track) => ({ ...track, url: url(track.url) })) })) };
}
