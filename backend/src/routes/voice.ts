// The wake-word pipeline's asset routes (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Any signed-in person, no role gate:
// these are static model bytes and a list of what's available, the same
// posture /api/llm/chat and /api/tts already take for their own
// non-privileged reads.
import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import {
  WAKEWORD_ALL_ASSETS,
  WAKEWORD_STOCK_DETECTOR,
  ensureWakewordAssets,
  wakewordAssetPath,
} from "@/lib/wakewordAssets";
import { getVoiceCatalog, isVoiceCatalogPath } from "@/lib/voiceCatalog";
import { setPersonTtsVoiceUnchecked, setValue, resetValue } from "@/lib/settings";
import { restartTtsBackend } from "@/lib/ttsSupervisor";
import type { AppEnv } from "@/types";

export const voiceRoutes = new Hono<AppEnv>();

// What the browser pipeline should load: the shared stage file names plus
// every available per-phrase detector, so the frontend registry
// (frontend/src/lib/voice/wake-word-models.ts) has one real source
// instead of a second, hand-duplicated copy of this list.
voiceRoutes.get("/wakewords", requireAuth, async (c) => {
  return c.json({
    detectors: [{ id: "hey_jarvis", label: "openWakeWord \"hey jarvis\"", file: WAKEWORD_STOCK_DETECTOR.file }],
  });
});

// A fixed allow-list, never a path built from the request: `:file` only
// ever selects one of the pinned assets this module already knows about,
// so there is no path-traversal surface here regardless of what a caller
// sends.
const ASSET_BY_FILE = new Map(WAKEWORD_ALL_ASSETS.map((a) => [a.file, a]));

voiceRoutes.get("/wakeword/:file", requireAuth, async (c) => {
  const file = c.req.param("file");
  const asset = ASSET_BY_FILE.get(file);
  if (!asset) return c.json({ error: `unknown wake-word asset: ${file}` }, 404);

  try {
    await ensureWakewordAssets();
  } catch (err) {
    return c.json({ error: `wake-word asset unavailable: ${(err as Error).message}` }, 503);
  }

  const bunFile = Bun.file(wakewordAssetPath(asset.file));
  return new Response(bunFile, { headers: { "content-type": "application/octet-stream" } });
});

// The full community voice catalog (2026-09-04, item 3 of the Pocket TTS
// follow-ups): every real file in `kyutai/tts-voices`, not just the 26
// bundled presets. ~2,069 short path strings - small enough to hand back
// in one response and let the browser search/group client-side rather
// than build server-side pagination for it.
voiceRoutes.get("/catalog", requireAuth, async (c) => {
  try {
    const entries = await getVoiceCatalog();
    return c.json({ entries });
  } catch (err) {
    return c.json({ error: `voice catalog unavailable: ${(err as Error).message}` }, 503);
  }
});

// Sets the signed-in person's OWN tts.voice_id to a catalog pick -
// never another person's, `actor` comes from the session, not the
// request body. `path` is checked against the REAL, live-fetched
// catalog (not just a shape check) before it's ever written: this is
// the one place `tts.voice_id` can hold something outside its normal
// 26-name option list, so the validation that matters has to happen
// here, not in the generic PUT /api/settings route (which would reject
// it outright - see lib/settings.ts's setPersonTtsVoiceUnchecked() for
// why that's deliberate).
voiceRoutes.post("/catalog/select", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { path?: string };
  const path = body.path;
  if (!path || typeof path !== "string") {
    return c.json({ error: "path is required" }, 400);
  }
  let entries;
  try {
    entries = await getVoiceCatalog();
  } catch (err) {
    return c.json({ error: `voice catalog unavailable: ${(err as Error).message}` }, 503);
  }
  if (!isVoiceCatalogPath(entries, path)) {
    return c.json({ error: `not a real voice catalog entry: ${path}` }, 400);
  }
  const result = setPersonTtsVoiceUnchecked(actor, `hf://kyutai/tts-voices/${path}`);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value);
});

// voice.hf_token has a side effect the generic PUT /api/settings route has
// no hook for: an already-running `pocket-tts serve` process read this
// setting once, at spawn time, and never again, so a saved or removed
// token only takes effect once ttsSupervisor.ts's cache is cleared and the
// next call re-spawns. This mirrors chat.model_id's own dedicated-route
// precedent (routes/host.ts's startSelectJob, for the identical reason -
// a setting change here needs a spawn side effect a plain write can't
// carry). setValue()/resetValue() are the same actor-gated functions the
// generic route itself calls, so the owner/admin check for a household
// key is enforced exactly once, in lib/settings.ts, not re-implemented
// here as a second requireRole gate that could drift from it.
voiceRoutes.post("/hf-token", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return c.json({ error: "token is required" }, 400);
  }
  const result = setValue(actor, "household", "voice.hf_token", token);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  await restartTtsBackend();
  return c.json(result.value);
});

voiceRoutes.post("/hf-token/remove", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = resetValue(actor, "household", "voice.hf_token");
  if (!result.ok) return c.json({ error: result.error }, result.status);
  await restartTtsBackend();
  return c.json(result.value);
});
