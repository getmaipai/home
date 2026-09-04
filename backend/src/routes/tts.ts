import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { synthesizeSpeech } from "@/lib/tts";
import { getPersonSettingValue } from "@/lib/settings";
import type { AppEnv } from "@/types";

export const ttsRoutes = new Hono<AppEnv>();

// Any signed-in person, no role gate: hearing your own household's chat
// reply spoken aloud isn't a privileged action, the same posture
// /api/llm/chat and /api/turn already take.
ttsRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  // The signed-in person's OWN choice (2026-09-04, "per user selection of
  // voice"): getPersonSettingValue() takes the actor itself, not a bare
  // id, so there is no parameter here that could read anyone else's
  // setting. Always a real preset name (the setting's registered default
  // is "alba", never an empty/unset sentinel), so this is safe to send
  // through unconditionally.
  const voiceId = getPersonSettingValue(actor, "tts.voice_id") as string;
  const result = await synthesizeSpeech(body.text ?? "", voiceId);
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  // Pipes Pocket TTS's chunked response straight through rather than
  // buffering it here first: buffering would put the whole reply's
  // generation time back on the critical path before any byte reaches
  // the browser, exactly what streaming exists to avoid.
  return new Response(result.value.stream, { headers: { "content-type": result.value.contentType } });
});
