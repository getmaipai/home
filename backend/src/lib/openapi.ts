// The @hono/zod-openapi scaffolding itself lives in
// @maipai/core/src/openapi now (core-v0.1.0, generic over the caller's
// own Hono Env instead of a hardcoded product type). Home's own
// apiRouter() below pins that generic to AppEnv once, here, so every
// existing call site keeps calling apiRouter() with no type argument.
import type { Context, MiddlewareHandler } from "hono";
import type { Result } from "@/lib/result";
import type { AppEnv } from "@/types";
import { OpenAPIHono } from "@hono/zod-openapi";

// AUDIT-DUP-ROUTES-01: PaginationQuerySchema and paginatedResponseSchema are no longer re-exported: nothing used them, and the five list routes differ by design
// (media offset 1-200 default 50, library cursor 1-60 default 60, recall 1-20 default 5, continue its own budget, diagnose its own copy). Core still has them.
export { ErrorSchema, errorResponses, idParamSchema } from "@maipai/core/src/openapi";

export function apiRouter() {
  return new OpenAPIHono<AppEnv>({ defaultHook: (result, c) => {
    if (!result.success) {
      const message = result.error.issues.map((issue) => {
        const path = issue.path.filter((part) => part !== "body").join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      }).join("; ");
      return c.json({ error: message, next: "Check the fields named and send it again." }, 400);
    }
  } });
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

/** AUDIT-DUP-ROUTES-01: refuse a route with `{ error }` and the refusal's own status. Returns `never` the way the routes' old
 * `as never` casts did: a typed OpenAPI route declares its statuses, and the lib's `Result<T, S>` already names the ones it can
 * refuse with, so the one cast lives here instead of at 100 call sites. */
export function refuseWith(c: Context, failure: { status: number; error: string }): never {
  return c.json({ error: failure.error }, failure.status as never) as never;
}

/** Answer a route from a lib `Result`: the value with `okStatus`, or the refusal. */
export function respond<T, S extends number>(c: Context, result: Result<T, S>, okStatus: 200 | 201 = 200): never {
  return (result.ok ? c.json(result.value as never, okStatus) : refuseWith(c, result)) as never;
}
