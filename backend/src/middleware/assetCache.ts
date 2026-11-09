import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";

/** Vite names every file under /assets by its content, so a file at a given address never changes: a phone may keep it for a year.
 * Without this the browser revalidated every file on every cold start (Safari on iPhone gets no service-worker cache). */
export const hashedAssetCache: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
};

/** The hub sent the app's JavaScript, CSS and wasm uncompressed (about 5 MB for the first screen). Gzip it; media is never touched. */
export const compressAssets: MiddlewareHandler = compress({
  contentTypeFilter: (type: string) => /^(text\/|application\/(javascript|json|wasm|manifest\+json)|image\/svg)/i.test(type),
});
