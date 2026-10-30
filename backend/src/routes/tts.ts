import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import { synthesizeSpeech } from "@/lib/tts";
import { getHouseholdSettingValue } from "@/lib/settings";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { speakerAgeBand } from "@/lib/ageBand";
import { getTtsTags } from "@/lib/ttsCapabilities";
import { DEFAULT_HESITATION_LEVEL, HESITATION_LEVELS, isProtectedSentence, planForPerson, sentenceIndexFor, type HesitationLevel } from "@/lib/voiceCues";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { isOwnedStaleTurnGeneration, turnAllowsVoiceCues, turnUtterance } from "@/routes/turn";
import { chooseDelivery } from "@/lib/deliveryChoice";

export const ttsRoutes = apiRouter();

const TTS_BODY = z.object({
  text: z.string().max(4_000),
  turn_id: z.string().optional(),
  generation: z.number().int().optional(),
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
    "Returns the signed-in person's text as an audio/wav stream using their own tts.voice_id setting, or the robot's selected voice for a robot device session. " +
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
    409: { content: { "application/json": { schema: TTS_ERROR } }, description: "The reply was stopped." },
  },
});

ttsRoutes.openapi(ttsSynthesizeRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  if (body.turn_id && body.generation !== undefined && isOwnedStaleTurnGeneration(body.turn_id, actor.id, body.generation)) return c.json({ error: "That reply was stopped, so this sentence was not spoken. Ask again to hear a new answer.", code: "turn_cancelled" }, 409);
  const voiceId = voiceForSpeech({ actor, deviceId: c.get("deviceId") });
  const startedAt = Date.now();
  // REG-02: the composer adds a spoken cue to a model-worded spoken turn's sentence, never to the written text.
  let spoken = body.text;
  if (body.turn_id) {
    const configured = getHouseholdSettingValue("voice.hesitations");
    const level = HESITATION_LEVELS.includes(configured as HesitationLevel) ? (configured as HesitationLevel) : DEFAULT_HESITATION_LEVEL;
    if (level !== "off") {
      const band = speakerAgeBand(actor, new Date()), supportedTags = await getTtsTags(), blocked = !turnAllowsVoiceCues(body.turn_id, actor.id);
      // VOICE-DELIVERY-01: from a turn's second sentence on, the small model chooses the delivery (never the first: it would delay the first sound).
      const choice = band === "adult" && !blocked && supportedTags.length > 0 && sentenceIndexFor(actor.id, body.turn_id) >= 1 && !isProtectedSentence(body.text.trim())
        ? await chooseDelivery(body.text, turnUtterance(body.turn_id, actor.id), supportedTags) : undefined;
      spoken = planForPerson(actor.id, { text: body.text, turnId: body.turn_id, level, band, supportedTags, blocked, choice }).text;
    }
  }
  const result = await synthesizeSpeech(spoken, voiceId);
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return new Response(result.value.stream, { headers: { "content-type": result.value.contentType, "x-maipai-tts-ttfa-ms": String(Math.max(0, Date.now() - startedAt)) } });
});
