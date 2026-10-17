// MEDIA-OFFLINE-01: opt-in bearer auth lives here only. Every item and asset read passes readableItem.
import { createRoute, z } from "@hono/zod-openapi";
import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireDeviceScope } from "@/middleware/auth";
import { readableItem } from "@/lib/media/access";
import { correctedStamp, writeProgress } from "@/lib/media/progress";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "@/lib/session";
import type { Context } from "hono";
import { keepRefusal, matches, missing, mediaFile, mediaManifest, playableItem } from "@/lib/offline/media";

export const mediaOfflineRoutes = apiRouter();
const gate = requireDeviceScope("media.offline");
const Kind = z.enum(["media", "video", "episode", "film", "track", "podcast_episode", "book", "audiobook", "chapter"]);
const Ref = z.object({ kind: Kind, id: z.string().min(1) }).strict();
/** The metering cursor key, derived by the server: the paired device, else the hashed browser session. Never a body field. */
function meterKeyOf(c: Context): string {
  const deviceId = c.get("deviceId") as string | undefined;
  if (deviceId) return `d:${deviceId}`;
  const session = getCookie(c, "session");
  return session ? `s:${hashSessionToken(session)}` : "-";
}

const errors = errorResponses({ 401: "Sign in to Home", 403: "Pair this device again, check its offline permission, or screen time is done (media_time_up, budget_keep_refused)", 404: "Check the library for this item" });

const manifest = createRoute({
  method: "get", path: "/manifest", tags: ["Media offline"], summary: "A hub-only manifest for keeping one media item",
  middleware: [gate] as const,
  request: { query: z.object({ id: z.string().min(1), kind: Kind.optional() }) },
  responses: { 200: { content: { "application/json": { schema: OfflineManifest } }, description: "One byte stream with readiness and my progress." }, ...errors },
});
mediaOfflineRoutes.openapi(manifest, (c) => {
  const { id, kind = "media" } = c.req.valid("query");
  const actor = c.get("person");
  const refused = keepRefusal(actor);
  if (refused) return c.json(refused, 403);
  if (!matches(readableItem(actor, id), kind)) return c.json({ error: missing }, 404);
  const result = mediaManifest(actor, id);
  return result ? c.json(result, 200) : c.json({ error: missing }, 404);
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
mediaOfflineRoutes.openapi(file, (c) => {
  const { id, kind } = c.req.valid("param");
  const actor = c.get("person");
  const refused = keepRefusal(actor);
  if (refused) return c.json(refused, 403);
  return mediaFile(actor, id, kind, c.req.raw);
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
