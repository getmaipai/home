// The chat program's generated-document routes (artifact-card/canvas-
// split): read one version by its own id, and export its body as a
// download. Creating and updating a version happens through the turn
// engine's own artifact tool, not through this file - these are read
// paths only.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { Artifact } from "@maipai/spec/gen/ts/artifact.js";
import { requireAuth } from "@/middleware/auth";
import { getArtifactRow, currentArtifactRow, visibleArtifactRow, toArtifact } from "@/lib/artifacts";
import type { AppEnv } from "@/types";

export const artifactsRoutes = apiRouter();

const EXTENSION_BY_KIND: Record<Artifact["kind"], string> = { markdown: "md", code: "txt", html: "html" };
const CONTENT_TYPE_BY_KIND: Record<Artifact["kind"], string> = { markdown: "text/markdown", code: "text/plain", html: "text/html" };

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

const getArtifactRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Artifacts"],
  summary: "Read one artifact version",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "art-example123") },
  responses: {
    200: { content: { "application/json": { schema: Artifact } }, description: "The artifact version." },
    ...errorResponses({ 401: "Sign in first", 404: "Artifact not found" }),
  },
});

artifactsRoutes.openapi(getArtifactRoute, (c) => {
  const actor = c.get("person");
  const row = getArtifactRow(c.req.valid("param").id);
  if (!row || !visibleArtifactRow(actor, row)) return c.json({ error: "artifact not found" }, 404);
  return c.json(toArtifact(row), 200);
});

// SHELL-02 slice 4: canvas-split's own acceptance ("a later turn's
// update to the same artifact id replaces the pane's content") reads
// naturally through here rather than needing the frontend to track
// `artifactKey` at all (Home-internal, never on the wire) - resolve
// `id` to its own key, then to whichever version is `isCurrent` right
// now (`currentArtifactRow()`, already used by `updateArtifact()`'s
// own "no longer current" 409 check). Any version's id resolves to
// the same current row, so the frontend can always ask "what does
// this artifact look like now" without knowing which version it last
// saw.
const getCurrentArtifactRoute = createRoute({
  method: "get",
  path: "/{id}/current",
  tags: ["Artifacts"],
  summary: "Read the current version of the artifact this version belongs to",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "art-example123") },
  responses: {
    200: { content: { "application/json": { schema: Artifact } }, description: "The artifact's current version." },
    ...errorResponses({ 401: "Sign in first", 404: "Artifact not found" }),
  },
});

artifactsRoutes.openapi(getCurrentArtifactRoute, (c) => {
  const actor = c.get("person");
  const row = getArtifactRow(c.req.valid("param").id);
  if (!row || !visibleArtifactRow(actor, row)) return c.json({ error: "artifact not found" }, 404);
  const current = currentArtifactRow(row.artifactKey) ?? row;
  if (!visibleArtifactRow(actor, current)) return c.json({ error: "artifact not found" }, 404);
  return c.json(toArtifact(current), 200);
});

const exportArtifactRoute = createRoute({
  method: "get",
  path: "/{id}/export",
  tags: ["Artifacts"],
  summary: "Download an artifact version's body",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "art-example123") },
  responses: {
    200: {
      content: { "text/markdown": { schema: z.string() }, "text/plain": { schema: z.string() }, "text/html": { schema: z.string() } },
      description: "The artifact's body, as a download (Content-Disposition: attachment) - the content type and file extension follow its kind (markdown/.md, code/.txt, html/.html).",
    },
    ...errorResponses({ 401: "Sign in first", 404: "Artifact not found" }),
  },
});

artifactsRoutes.openapi(exportArtifactRoute, (c) => {
  const actor = c.get("person");
  const row = getArtifactRow(c.req.valid("param").id);
  if (!row || !visibleArtifactRow(actor, row)) return c.json({ error: "artifact not found" }, 404);
  const kind = row.kind as Artifact["kind"];
  c.header("Content-Type", `${CONTENT_TYPE_BY_KIND[kind]}; charset=utf-8`);
  c.header("Content-Disposition", `attachment; filename="${slugify(row.title)}.${EXTENSION_BY_KIND[kind]}"`);
  return c.body(row.body);
});
