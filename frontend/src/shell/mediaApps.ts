// MEDIA-VIDEOS-01: which media app plays which kind of item, and where its play page is. The backend's twin is
// backend/src/lib/media/appHost.ts (MEDIA_APPS: the data ids each app serves); this is the shell's half (a link or a `play` action
// becomes a route). Videos is built; the other four apps use the same table when their packages land.
export interface MediaAppTarget {
  app: string;
  /** The app's page that plays one item, named in its manifest. */
  page: string;
}

export const MEDIA_APP_FOR_KIND: Readonly<Record<string, MediaAppTarget>> = {
  video: { app: "videos", page: "watch" },
  episode: { app: "shows", page: "watch" },
  film: { app: "shows", page: "watch" },
  track: { app: "music", page: "play" },
  podcast_episode: { app: "podcasts", page: "play" },
  book: { app: "books", page: "read" },
  audiobook: { app: "books", page: "read" },
  chapter: { app: "books", page: "read" },
};

export const MEDIA_APP_IDS: readonly string[] = [...new Set(Object.values(MEDIA_APP_FOR_KIND).map((target) => target.app))];

export const isMediaApp = (id: string): boolean => MEDIA_APP_IDS.includes(id);

/** The route that plays `id`, for an item of this kind; null for a kind no app plays. The id also rides in the query so a reload or a
 * shared link opens the same item (PackageAppPage reads it into the page's state). */
export function playRoute(kind: string, id: string): string | null {
  const target = MEDIA_APP_FOR_KIND[kind];
  return target ? `/apps/${target.app}/${target.page}?id=${encodeURIComponent(id)}` : null;
}

/** The media app whose area this path is in (`/apps/videos/watch` is `videos`), or null. */
export function mediaAppOfPath(pathname: string): string | null {
  const match = /^\/apps\/([a-z][a-z0-9-]*)(?:\/|$)/.exec(pathname);
  return match && isMediaApp(match[1]!) ? match[1]! : null;
}

/** MEDIA-POLISH-01: the page of `app` that plays one item (`watch` for Videos), or null for an app that is not a media app. */
export function playPageOf(app: string): string | null {
  return Object.values(MEDIA_APP_FOR_KIND).find((target) => target.app === app)?.page ?? null;
}

/** The first tab of a media app: "Home" for Videos and Shows, "Listen now" for the audio apps (Apple's and Spotify's word), "Reading now" for Books. */
/** The first tab of an app's own toolbar: a media app names it for what it does, News calls it Today (its index page is the day's
 * stories), and any other package app keeps the generic "Overview". */
export function appHomeLabel(app: string, media: boolean): string {
  if (media) return homeLabelOf(app);
  return app === "news" ? "Today" : "Overview";
}

export function homeLabelOf(app: string): string {
  if (app === "podcasts" || app === "music") return "Listen now";
  if (app === "books") return "Reading now";
  return "Home";
}
