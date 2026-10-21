// MEDIA-HOME-01: the Media home page's data. One GET for the signed-in person's three shelves: "continue" (unfinished non-music titles),
// "new" (the newest additions of every media app) and "recent_music" (songs played lately). Every read goes through the same access
// gates as the apps themselves, so a child's home never shows what the child may not read.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import { mediaContinueRows } from "@/lib/continue/providers";
import { readableItem } from "@/lib/media/access";
import { recentProgress } from "@/lib/media/progress";
import { MEDIA_APPS, MEDIA_APP_IDS, queryItems, type MediaAppId } from "@/lib/media/appHost";

export const mediaHomeRoutes = apiRouter();

interface Row {
  id: string;
  app: MediaAppId;
  kind: string;
  title: string;
  subtitle: string | null;
  artwork_url: string | null;
  href: string;
  percent: number | null;
  at: string;
}

/** The app that owns an item kind; null when no app does (the row stays off the home). */
function appForKind(kind: string | null): MediaAppId | null {
  if (!kind) return null;
  for (const appId of MEDIA_APP_IDS) {
    if ((MEDIA_APPS[appId].kinds as readonly string[]).includes(kind)) return appId;
  }
  return null;
}

const RowSchema = z.object({
  id: z.string(),
  app: z.enum(["videos", "shows", "music", "podcasts", "books"]),
  kind: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  artwork_url: z.string().nullable(),
  href: z.string().describe("Where the row leads; the media shell resolves it to the app that opens it."),
  percent: z.number().nullable().describe("Continue rows: how far along, 0 to 100, when known."),
  at: z.string().describe("When the person last touched it (continue, recent music) or when it was added (new), ISO."),
});

/** A shelf builds alone: a thrown error hides the shelf (and logs a warning) and never fails the page. */
export function safely<T>(label: string, build: () => T[]): T[] {
  try {
    return build();
  } catch (error) {
    console.warn("[media.home] shelf failed:", label, error instanceof Error ? error.message : String(error));
    return [];
  }
}

function homeFor(person: PersonRow): { continue: Row[]; new: Row[]; recent_music: Row[] } {
  // Continue: the Pick up logic, minus the shelf's budget, mapped onto an app.
  const continueRows = safely("continue", () =>
    mediaContinueRows(person, 12)
      .map((row): Row | null => {
        const app = appForKind(row.media_kind);
        if (!app) return null;
        return {
          id: row.id, app, kind: row.media_kind ?? "media", title: row.title, subtitle: row.subtitle,
          artwork_url: row.artwork_url, href: row.href, percent: row.percent, at: row.at,
        };
      })
      .filter((row): row is Row => row !== null),
  );

  // New: a handful per app, merged and ordered by when the item joined the library.
  const fresh = safely("new", () => {
    const rows: Row[] = [];
    for (const appId of MEDIA_APP_IDS) {
      for (const item of safely(`new:${appId}`, () => queryItems(person, appId, { limit: 6 }))) {
        rows.push({
          id: item.id, app: appId, kind: item.kind, title: item.title, subtitle: item.subtitle ?? null,
          artwork_url: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null, href: `/media/${encodeURIComponent(item.id)}`,
          percent: null, at: item.added_at,
        });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows.slice(0, 12);
  });

  // Recent music: songs the person played lately, newest first, each once.
  const music = safely("recent_music", () => {
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const progress of recentProgress(person.id, 100)) {
      const item = readableItem(person, progress.media_id);
      if (!item || item.kind !== "track" || seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push({
        id: item.id, app: "music", kind: "track", title: item.title, subtitle: item.subtitle ?? null,
        artwork_url: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null, href: `/media/${encodeURIComponent(item.id)}`,
        percent: null, at: progress.updated_at,
      });
      if (rows.length >= 8) break;
    }
    return rows;
  });

  return { continue: continueRows, new: fresh, recent_music: music };
}

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Media"],
  summary: "The media home: my unfinished titles, the newest additions of every app, and my recent songs",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ continue: z.array(RowSchema), new: z.array(RowSchema), recent_music: z.array(RowSchema) }) } }, description: "My shelves. A guest gets none." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
mediaHomeRoutes.openapi(route, (c) => c.json(homeFor(c.get("person")), 200));
