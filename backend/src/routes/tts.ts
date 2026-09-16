import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import { synthesizeSpeech } from "@/lib/tts";
import { getPersonSettingValue } from "@/lib/settings";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const ttsRoutes = apiRouter();

const TTS_BODY = z.object({
  text: z.string().max(4_000),
});

// TTS errors carry a machine-readable `code` alongside the human message -
// the same shape lib/tts.ts's TtsOpResult uses.
const TTS_ERROR = z.object({
  error: z.string(),
  code: z.string(),
});

const ttsSynthesizeRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Voice"],
  summary: "Synthesize speech",
  description:
    "Returns the signed-in person's text as an audio/wav stream using their own tts.voice_id setting. " +
    "Pipes the TTS backend's response stream straight through without buffering.",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "application/json": { schema: TTS_BODY } } },
  },
  responses: {
    200: {
      content: { "audio/wav": { schema: z.string().openapi({ format: "binary" }) } },
      description: "The synthesized audio stream.",
    },
    400: {
      content: { "application/json": { schema: TTS_ERROR } },
      description: "Invalid input (empty or too-long text).",
    },
    401: {
      content: { "application/json": { schema: TTS_ERROR } },
      description: "Not signed in.",
    },
  },
});

ttsRoutes.openapi(ttsSynthesizeRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const voiceId = getPersonSettingValue(actor, "tts.voice_id") as string;
  const result = await synthesizeSpeech(body.text, voiceId);
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return new Response(result.value.stream, { headers: { "content-type": result.value.contentType } });
});
