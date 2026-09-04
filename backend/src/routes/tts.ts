import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { synthesizeSpeech } from "@/lib/tts";
import type { AppEnv } from "@/types";

export const ttsRoutes = new Hono<AppEnv>();

// Any signed-in person, no role gate: hearing your own household's chat
// reply spoken aloud isn't a privileged action, the same posture
// /api/llm/chat and /api/turn already take.
ttsRoutes.post("/", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const result = await synthesizeSpeech(body.text ?? "");
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  // Pipes Pocket TTS's chunked response straight through rather than
  // buffering it here first: buffering would put the whole reply's
  // generation time back on the critical path before any byte reaches
  // the browser, exactly what streaming exists to avoid.
  return new Response(result.value.stream, { headers: { "content-type": result.value.contentType } });
});
