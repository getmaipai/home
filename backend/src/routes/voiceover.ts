import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { makeVoiceover, voicesFor } from "@/lib/voiceover";
import { changeVoice } from "@/lib/changeVoice";

export const voiceoverRoutes = apiRouter();
const voice = z.object({ id: z.string(), label: z.string(), kind: z.enum(["preset", "clip"]), engine: z.enum(["fish-audio-drama-3", "chatterbox-turbo"]), tags: z.array(z.string()) });
const result = z.object({ file_id: z.string(), seconds: z.number().nullable(), engine: z.enum(["fish-audio-drama-3", "chatterbox-turbo"]), revision: z.string().optional(), voice: z.string(), kind: z.enum(["preset", "clip"]) });

voiceoverRoutes.openapi(createRoute({ method: "get", path: "/options", tags: ["Voice"], summary: "Voiceover voices available to the signed-in person", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ voices: z.array(voice) }) } }, description: "Available voices and their tags." }, ...errorResponses({ 401: "Not signed in" }) },
}), async (c) => c.json({ voices: await voicesFor(c.get("person")) }, 200));

voiceoverRoutes.openapi(createRoute({ method: "post", path: "/", tags: ["Voice"], summary: "Create a voiceover in the Library", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ script: z.string().max(2000), voice: z.string().max(500).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: result } }, description: "The saved audio file." }, 400: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Invalid script." }, 403: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Refused by the content or age policy." }, 422: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Unknown voice." }, 503: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Speech unavailable." }, ...errorResponses({ 401: "Not signed in" }) },
}), async (c) => {
  const made = await makeVoiceover(c.get("person"), c.req.valid("json"));
  if (!made.ok) return c.json({ error: made.line }, made.status);
  return c.json({ file_id: made.file_id, seconds: made.seconds, engine: made.engine, ...(made.revision ? { revision: made.revision } : {}), voice: made.voice, kind: made.kind }, 200);
});

const changed = z.object({ file_id: z.string(), kind_of_source: z.enum(["audio", "video"]), seconds: z.number().nullable(), spoken_seconds: z.number().nullable(), source_seconds: z.number().nullable(), difference_seconds: z.number().nullable(), engine: z.enum(["fish-audio-drama-3", "chatterbox-turbo"]), revision: z.string().optional(), voice: z.string(), kind: z.enum(["preset", "clip"]) });
voiceoverRoutes.openapi(createRoute({ method: "post", path: "/change", tags: ["Voice"], summary: "Change the voice in an owned Library audio or video file", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ file_id: z.string().max(80), voice: z.string().max(500).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: changed } }, description: "The changed voice Library file." }, 403: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "The request is refused." }, 404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "The owned audio or video file was not found." }, 422: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Speech or voice is not usable." }, 503: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Speech or video editing is unavailable." }, ...errorResponses({ 401: "Not signed in" }) },
}), async (c) => {
  const made = await changeVoice(c.get("person"), c.req.valid("json"));
  if (!made.ok) return c.json({ error: made.line }, made.status);
  const { ok: _ok, ...body } = made;
  return c.json(body, 200);
});
