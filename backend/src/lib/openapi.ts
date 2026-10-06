// The @hono/zod-openapi scaffolding itself lives in
// @maipai/core/src/openapi now (core-v0.1.0, generic over the caller's
// own Hono Env instead of a hardcoded product type). Home's own
// apiRouter() below pins that generic to AppEnv once, here, so every
// existing call site keeps calling apiRouter() with no type argument.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/types";
import { apiRouter as apiRouterCore } from "@maipai/core/src/openapi";

export { ErrorSchema, errorResponses, idParamSchema, PaginationQuerySchema, paginatedResponseSchema } from "@maipai/core/src/openapi";

export function apiRouter() {
  return apiRouterCore<AppEnv>();
}

/** Route middleware for a converted route whose plain-Hono version read the
 * body with `c.req.json().catch(() => ({}))`: an empty JSON body still
 * means `{}`, instead of the validator's "Malformed JSON" 400 (PROJECTS-01a
 * review). Runs before the route's validators. */
export const emptyJsonBodyAsObject: MiddlewareHandler<AppEnv> = async (c, next) => {
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    const text = await c.req.raw.clone().text();
    if (text.trim() === "") {
      c.req.raw = new Request(c.req.raw.url, { method: c.req.raw.method, headers: c.req.raw.headers, body: "{}" });
    }
  }
  await next();
};
