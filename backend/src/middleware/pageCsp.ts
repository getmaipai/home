// PI-RENDER-01 (F1): the Content-Security-Policy on the app page. A reply is
// model-written, so even if a renderer path were missed, the browser still
// refuses to load an image, script, frame or connection from any host but the
// hub itself. This is the backstop; the markdown renderer's own image and link
// controls are the first line (commons ui markdown-text).
//
// Measured against the built app (frontend/dist): the Vite build emits only
// same-origin module scripts and CSS, the PWA service worker and the ONNX
// wasm runtime (wake word, face models) need `wasm-unsafe-eval` and blob
// workers, React and the code highlighter set inline `style` attributes, and
// the speech socket is same-origin. Nothing in the frontend loads from a
// remote host, so no host is listed anywhere.
import type { MiddlewareHandler } from "hono";

export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Sets the policy on every non-API response (the page and its assets). API
 * routes keep their own headers (the answer-image route sends its own
 * `default-src 'none'`). */
export const pageCsp: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/")) return;
  if (!c.res.headers.has("Content-Security-Policy")) c.header("Content-Security-Policy", PAGE_CSP);
};
