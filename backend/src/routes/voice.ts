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
