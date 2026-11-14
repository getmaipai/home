import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";

export const clientErrorRoutes = apiRouter();
const WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 4 * 1024;
const reports = new Map<string, number[]>();
const bodySchema = z.object({
  kind: z.enum(["error", "unhandledrejection", "boundary", "player"]),
  name: z.string().max(500).optional(), message: z.string().max(4000).optional(), stack: z.string().max(12000).optional(),
  route: z.string().max(1000).optional(), song_id: z.string().max(100).optional(), media_type: z.string().max(100).optional(), build: z.string().max(100).optional(),
}).strict();

const bodyCap = createMiddleware(async (c, next) => {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return c.json({ error: "This report is too large. Send a smaller report." }, 413);
  const stream = c.req.raw.clone().body;
  if (stream) {
    const reader = stream.getReader();
    let size = 0;
    try {
      while (size <= MAX_BODY_BYTES) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
      }
    } finally { void reader.cancel().catch(() => {}); }
    if (size > MAX_BODY_BYTES) return c.json({ error: "This report is too large. Send a smaller report." }, 413);
  }
  await next();
});

export function scrubClientText(value: string, limit: number): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:bearer\s+)?(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{32,})\b/gi, "[token]")
    .replace(/([?&][^\s=&#]+=)[^\s&#]*/g, "$1[redacted]")
    .slice(0, limit);
}

const postRoute = createRoute({
  method: "post", path: "/", tags: ["Client errors"], summary: "Send a scrubbed browser error to the Home log",
  middleware: [requireAuth, bodyCap] as const,
  request: { body: { required: true, content: { "application/json": { schema: bodySchema } } } },
  responses: { 204: { description: "Error accepted." }, ...errorResponses({ 400: "The report is not valid JSON", 401: "Not signed in", 413: "The report is too large", 429: "Too many reports. Try again in a minute." }) },
});

clientErrorRoutes.openapi(postRoute, async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return c.json({ error: "This report is too large. Send a smaller report." }, 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return c.json({ error: "This report is too large. Send a smaller report." }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return c.json({ error: "This report is not valid JSON. Try again." }, 400); }
  const body = bodySchema.safeParse(parsed);
  if (!body.success) return c.json({ error: "This report has fields Home cannot use. Reload the page and try again." }, 400);

  const now = Date.now(), personKey = c.get("person").id;
  const recent = (reports.get(personKey) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= 10) { reports.set(personKey, recent); return c.json({ error: "Too many reports. Try again in a minute." }, 429); }
  recent.push(now); reports.set(personKey, recent);
  const route = `/${(body.data.route ?? "/").split("?", 1)[0]!.split("/").filter(Boolean)[0]?.slice(0, 80) ?? ""}`;
  const line = {
    component: "client", event: "error", kind: body.data.kind,
    name: scrubClientText(body.data.name ?? "Error", 200), message: scrubClientText(body.data.message ?? "Browser error", 200),
    stack: scrubClientText((body.data.stack ?? "").split("\n").slice(1).join("\n"), 1500), route,
    ...(body.data.kind === "player" ? { media_type: scrubClientText(body.data.media_type ?? "unknown", 100), ...(body.data.song_id && /^[A-Za-z0-9_-]{3,100}$/.test(body.data.song_id) ? { song_id: body.data.song_id } : {}) } : {}),
    ...(body.data.build ? { build: scrubClientText(body.data.build, 100) } : {}),
  };
  console.error(JSON.stringify(line));
  return c.body(null, 204);
});
