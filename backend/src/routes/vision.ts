import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import {
  VISION_ALL_ASSETS,
  VISION_FACE_DETECTOR,
  VISION_FACE_EMBEDDER,
  areVisionAssetsInstalled,
  ensureVisionAssets,
  visionAssetPath,
} from "@/lib/visionAssets";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const visionRoutes = apiRouter();

const modelsRoute = createRoute({
  method: "get",
  path: "/models",
  tags: ["Vision"],
  summary: "List available face vision models",
  description: "The fixed list of face detector and embedding models the browser can load.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            detectors: z.array(z.object({ id: z.string(), label: z.string(), file: z.string() })),
            installed: z.boolean(),
          }),
        },
      },
      description: "The list of available face vision models.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

visionRoutes.openapi(modelsRoute, async (c) => {
  return c.json(
    {
      detectors: [
        { id: "yunet-2026may", label: "YuNet face detector (May 2026)", file: VISION_FACE_DETECTOR.file },
        { id: "sface-2021dec", label: "OpenCV SFace (December 2021)", file: VISION_FACE_EMBEDDER.file },
      ],
      installed: areVisionAssetsInstalled(),
    },
    200,
  );
});

const ASSET_BY_FILE = new Map(VISION_ALL_ASSETS.map((asset) => [asset.file, asset]));

const visionFileRoute = createRoute({
  method: "get",
  path: "/model/:file",
  tags: ["Vision"],
  summary: "Download a face vision model",
  description: "Serves one pinned face vision model selected from a fixed allow-list.",
  middleware: [requireAuth] as const,
  request: { params: z.object({ file: z.string() }) },
  responses: {
    200: {
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
      description: "The raw model file bytes.",
    },
    ...errorResponses({ 401: "Not signed in", 404: "Unknown vision asset", 503: "Asset unavailable" }),
  },
});

visionRoutes.openapi(visionFileRoute, async (c) => {
  const file = c.req.valid("param").file;
  const asset = ASSET_BY_FILE.get(file);
  if (!asset) return c.json({ error: `unknown vision asset: ${file}` }, 404);

  try {
    await ensureVisionAssets();
  } catch (err) {
    return c.json({ error: `vision asset unavailable: ${(err as Error).message}` }, 503);
  }

  const bunFile = Bun.file(visionAssetPath(asset.file));
  return new Response(bunFile, { status: 200, headers: { "content-type": "application/octet-stream" } });
});
