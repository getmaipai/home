// MEDIA-OFFLINE-01: opt-in bearer auth lives here only. Every item and asset read passes readableItem.
import { createRoute, z } from "@hono/zod-openapi";
import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireDeviceScope } from "@/middleware/auth";
import { decidePlayable } from "@/lib/media/kinds";
import { extensionOf } from "@/lib/media/parsers/text";
import { readableItem } from "@/lib/media/access";
import { itemByteMetadata, serveItemArtwork, serveItemBytes } from "@/lib/media/serve";
import { correctedStamp, getProgress, writeProgress } from "@/lib/media/progress";
import { mediaTimeUpRefusal, minorMayKeepOffline } from "@/lib/media/watchTime";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "@/lib/session";
import type { Context } from "hono";
import type { PersonRow } from "@/types";
import { readAttachment } from "@/lib/attachments";
import type { MediaItem } from "@/lib/media/model";

export const mediaOfflineRoutes = apiRouter();
const gate = requireDeviceScope("media.offline");
const Kind = z.enum(["media", "video", "episode", "film", "track", "podcast_episode", "book", "audiobook", "chapter"]);
const Ref = z.object({ kind: Kind, id: z.string().min(1) }).strict();
const matches = (item: MediaItem | null, kind: string): item is MediaItem => item !== null && (kind === "media" || kind === item.kind);

// A probed row already carries this decision. Reuse the same rule for a row whose codecs arrived before its decision.
function playableItem(item: MediaItem | null): MediaItem | null {
  if (!item || item.playable !== "unknown" || (!item.video_codec && !item.audio_codec)) return item;
  const location = item.location as { path?: string };
  return { ...item, playable: decidePlayable({ ext: extensionOf(location.path ?? ""), hasVideo: item.video_codec !== null, hasAudio: item.audio_codec !== null, videoCodec: item.video_codec, audioCodec: item.audio_codec }) };
}

/** MEDIA-KID-01: keeping media is refused for a minor whose time is up, and for any minor with a daily media budget (offline
 * time cannot be metered). Neither code is `device_revoked`, so the browser keeps its existing copies. */
function keepRefusal(actor: PersonRow): { error: string; code: "media_time_up" | "budget_keep_refused" } | null {
  const timeUp = mediaTimeUpRefusal(actor);
  if (timeUp) return timeUp;
  if (!minorMayKeepOffline(actor)) return { error: "Keeping a title for later is off while you have screen time limits. Ask a grown-up.", code: "budget_keep_refused" };
  return null;
}
/** The metering cursor key, derived by the server: the paired device, else the hashed browser session. Never a body field. */
function meterKeyOf(c: Context): string {
  const deviceId = c.get("deviceId") as string | undefined;
  if (deviceId) return `d:${deviceId}`;
  const session = getCookie(c, "session");
  return session ? `s:${hashSessionToken(session)}` : "-";
}

const SUBTITLE_TYPES = new Set(["text/vtt", "text/plain", "application/x-subrip", "text/srt"]);
const missing = "This item is not available to you on Home. Check your library, then try again.";
const errors = errorResponses({ 401: "Sign in to Home", 403: "Pair this device again, check its offline permission, or screen time is done (media_time_up, budget_keep_refused)", 404: "Check the library for this item" });

const manifest = createRoute({
  method: "get", path: "/manifest", tags: ["Media offline"], summary: "A hub-only manifest for keeping one media item",
  middleware: [gate] as const,
  request: { query: z.object({ id: z.string().min(1), kind: Kind.optional() }) },
  responses: { 200: { content: { "application/json": { schema: OfflineManifest } }, description: "One byte stream with readiness and my progress." }, ...errors },
});
mediaOfflineRoutes.openapi(manifest, (c) => {
  const actor = c.get("person");
  const { id, kind = "media" } = c.req.valid("query");
  const refused = keepRefusal(actor);
  if (refused) return c.json(refused, 403);
  const item = playableItem(readableItem(actor, id));
  if (!matches(item, kind)) return c.json({ error: missing }, 404);
  const metadata = itemByteMetadata(actor, item);
  const ready = metadata !== null && item.fingerprint !== null && item.playable === "original";
  const reason = !metadata || !item.fingerprint ? "notOnServer" : item.playable === "none" ? "notPlayable" : ready ? null : "notReady";
  const progress = getProgress(actor.id, id);
  const bytes = metadata?.size ?? item.size ?? 0;
  return c.json(OfflineManifest.parse({
    kind: "media", id, title: item.title, subtitle: item.subtitle, total_bytes: bytes, generated_at: new Date().toISOString(),
    entries: [{
      id, title: item.title, url: `/api/media/offline/file/media/${id}`, bytes, mime: item.media_type,
      fingerprint: item.fingerprint ?? "unavailable", ready, playable: item.playable, reason, duration_s: item.duration_s,
      artwork_url: item.artwork ? `/api/media/offline/file/artwork/${id}` : null,
      chapters: item.chapters.map(({ start_s, title }) => ({ start_s, title })),
      subtitles: item.subtitles.map(({ lang, label }, index) => ({ lang, label, url: `/api/media/offline/file/subtitle/${id}?track=${index}` })),
      progress: progress && "seconds" in progress.position ? { position_s: progress.position.seconds, completed: progress.completed } : null,
    }],
  }), 200);
});

const file = createRoute({
  method: "get", path: "/file/{kind}/{id}", tags: ["Media offline"], summary: "Offline media bytes, artwork or a subtitle from the hub",
  middleware: [gate] as const,
  request: { params: z.object({ kind: z.enum([...Kind.options, "artwork", "subtitle"]), id: z.string().min(1) }), query: z.object({ track: z.coerce.number().int().min(0).optional() }) },
  responses: {
    200: { description: "Complete bytes, fingerprint ETag, Last-Modified, private no-store." },
    206: { description: "Requested range. If-Range accepts the strong ETag or Last-Modified date." },
    ...errors, ...errorResponses({ 409: "This file cannot play; choose another item", 422: "Play the parts of this folder", 416: "Request a range inside the file", 503: "Copy not ready; Retry-After: 60" }),
  },
});
mediaOfflineRoutes.openapi(file, async (c) => {
  const actor = c.get("person");
  const { id, kind } = c.req.valid("param");
  const refused = keepRefusal(actor);
  if (refused) return c.json(refused, 403);
  const item = playableItem(readableItem(actor, id));
  if (!item || (!["artwork", "subtitle"].includes(kind) && !matches(item, kind))) return c.json({ error: missing }, 404);
  if (kind === "artwork") {
    const response = await serveItemArtwork(actor, item);
    if (!(response instanceof Response)) return c.json({ error: "This picture is not available. Try keeping the item again later." }, response.status);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (kind === "subtitle") {
    const track = item.subtitles[c.req.valid("query").track ?? 0];
    const read = track ? readAttachment(actor, track.file_id) : null;
    if (!read?.ok) return c.json({ error: "This subtitle is not available. Try keeping the item again later." }, 404);
    // Only caption types are served, always as text/vtt, sandboxed: a stored file can never run as a page or script.
    if (!SUBTITLE_TYPES.has(read.value.record.media_type.split(";")[0]!.trim().toLowerCase())) return c.json({ error: "This subtitle is not available. Try keeping the item again later." }, 404);
    return new Response(read.value.bytes as never, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  }
  if (item.playable === "none") return c.json({ error: "This file cannot play on this device. Choose another item." }, 409);
  if (item.playable !== "original") {
    c.header("Retry-After", "60");
    return c.json({ error: "This copy is not ready. Try again later; files that need conversion are not supported yet." }, 503);
  }
  const metadata = itemByteMetadata(actor, item);
  if (!metadata || !item.fingerprint) return c.json({ error: "This file is not saved on Home. Check its library folder, then try again." }, 404);
  // JSON's string escaping also prevents a malformed stored fingerprint from becoming a header injection.
  const etag = JSON.stringify(item.fingerprint);
  const modified = metadata.modified.toUTCString();
  const ifRange = c.req.header("if-range");
  const dateMatches = ifRange !== undefined && !ifRange.startsWith('"') && !ifRange.startsWith("W/") && Number.isFinite(Date.parse(ifRange)) && Math.floor(metadata.modified.getTime() / 1000) === Math.floor(Date.parse(ifRange) / 1000);
  const range = !ifRange || ifRange === etag || dateMatches ? c.req.header("range") : undefined;
  const response = await serveItemBytes(actor, item, range);
  if (!(response instanceof Response)) return c.json({ error: "This file could not be read. Check its library folder, then try again." }, response.status);
  response.headers.set("ETag", etag);
  response.headers.set("Last-Modified", modified);
  return response;
});

const status = createRoute({
  method: "post", path: "/status", tags: ["Media offline"], summary: "Check up to 500 kept fingerprints without disclosing unreadable items",
  middleware: [gate] as const,
  request: { body: { content: { "application/json": { schema: z.object({ items: z.array(Ref.extend({ fingerprint: z.string().min(1) })).max(500) }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ items: z.array(Ref.extend({ status: z.enum(["ok", "changed", "gone"]) })) }) } }, description: "Results in request order. Gone includes items this person cannot read." }, ...errors },
});
mediaOfflineRoutes.openapi(status, (c) => c.json({ items: c.req.valid("json").items.map(({ kind, id, fingerprint }) => {
  const item = readableItem(c.get("person"), id);
  return { kind, id, status: !matches(item, kind) ? "gone" as const : item.fingerprint === fingerprint ? "ok" as const : "changed" as const };
}) }, 200));

const progress = createRoute({
  method: "post", path: "/progress", tags: ["Media offline"], summary: "Merge up to 200 offline progress events after clock correction",
  middleware: [gate] as const,
  request: { body: { content: { "application/json": { schema: z.object({
    sent_at: z.string().datetime({ offset: true }),
    events: z.array(Ref.extend({ position_s: z.number().finite().min(0), duration_s: z.number().finite().min(0).nullable(), at: z.string().datetime({ offset: true }), finished: z.boolean() })).max(200),
  }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ results: z.array(Ref.extend({ status: z.enum(["applied", "older", "gone", "refused"]), reason: z.string().nullable() })) }) } }, description: "Each event uses writeProgress, including minor device protection." }, ...errors, ...errorResponses({ 400: "restamp: reset sent_at and event timestamps before retrying" }) },
});
mediaOfflineRoutes.openapi(progress, (c) => {
  const { sent_at, events } = c.req.valid("json");
  const actor = c.get("person");
  const now = new Date();
  const meterKey = meterKeyOf(c);
  const sent = Date.parse(sent_at);
  // Reject the whole batch before writing anything. Event clocks may be skewed along with sent_at.
  if (sent > now.getTime() + 300_000 || events.some((event) => Date.parse(event.at) - sent > 300_000)) return c.json({ error: "restamp" }, 400);
  return c.json({ results: events.map((event) => {
    const { kind, id } = event;
    const item = playableItem(readableItem(actor, id));
    if (!matches(item, kind)) return { kind, id, status: "gone" as const, reason: missing };
    const result = writeProgress(actor, item, {
      position: { seconds: event.position_s }, duration_s: event.duration_s,
      ...(event.finished ? { completed: true } : {}),
      device_id: c.get("deviceId") ?? null,
      stamp: correctedStamp({ sampledAt: event.at, clientNow: sent_at, serverNow: now }),
    }, { now, immediate: true, meterKey });
    if (!result.ok) return { kind, id, status: "refused" as const, reason: result.refusal === "other_persons_device" ? "This device belongs to someone else. Use your own device to save your place." : "This item needs a place in the text. Save book progress while online." };
    return { kind, id, status: result.positionApplied ? "applied" as const : "older" as const, reason: null };
  }) }, 200);
});
