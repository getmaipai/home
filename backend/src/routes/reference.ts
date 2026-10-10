// KS-02: the page a library source card opens, `/api/reference/<book>/<path>`.
// It serves Home's own extract of the article (title, lead, facts, licence and
// snapshot lines) as a small static page, never the library's raw HTML: no
// script, no outside request, nothing a page could do on its own. It reads
// through readReferencePage, so the book must be on the asker's closed list
// and a minor's floor applies exactly as it does to a search.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { readReferencePage } from "@/lib/retrieval/referenceReader";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";

export const referenceRoutes = apiRouter();

const getRoute = createRoute({
  method: "get",
  path: "/{book}/{path}",
  tags: ["Sources"],
  summary: "A cited article from the home's offline library",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({
      book: z.string().min(1).max(200).openapi({ param: { name: "book", in: "path" } }),
      path: z.string().min(1).max(500).openapi({ param: { name: "path", in: "path" } }),
    }),
  },
  responses: {
    200: { content: { "text/html": { schema: z.string() } }, description: "The article as a static page." },
    404: { description: "That article is not in the library, or is not available to this person." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderReferencePage(row: ReferenceRow): string {
  const licence = row.licence === "public-domain" ? "Public domain" : "CC BY-SA 4.0";
  const body = row.disambiguation
    ? `<p>Several articles share this name:</p><ul>${row.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
    : `${row.lead
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}${row.infobox.length > 0 ? `<dl>${row.infobox.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>` : ""}`;
  const when = row.snapshotDate ? `, offline copy from ${esc(row.snapshotDate)}` : ", offline copy";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(row.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}footer{margin-top:2rem;font-size:.875rem;opacity:.7}</style></head><body><h1>${esc(row.title)}</h1>${body}<footer>${esc(row.sourceLabel)}, ${licence}${when}.</footer></body></html>`;
}

referenceRoutes.openapi(getRoute, async (c) => {
  const { book, path } = c.req.valid("param");
  const band = speakerAgeBand(c.get("person"), new Date());
  let row: ReferenceRow | null = null;
  try {
    row = await readReferencePage({ book, path, band });
  } catch {
    row = null;
  }
  if (!row) {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body("That article is not available. It may not be in this home's offline library, or the library may be switched off. Go back and search again, or ask an adult to check the library in Settings.", 404);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "private, max-age=3600");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  return c.body(renderReferencePage(row), 200);
});
