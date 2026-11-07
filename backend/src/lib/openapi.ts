// The @hono/zod-openapi scaffolding itself lives in
// @maipai/core/src/openapi now (core-v0.1.0, generic over the caller's
// own Hono Env instead of a hardcoded product type). Home's own
// apiRouter() below pins that generic to AppEnv once, here, so every
// existing call site keeps calling apiRouter() with no type argument.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/types";
import { OpenAPIHono } from "@hono/zod-openapi";

export { ErrorSchema, errorResponses, idParamSchema, PaginationQuerySchema, paginatedResponseSchema } from "@maipai/core/src/openapi";

export function apiRouter() {
  return new OpenAPIHono<AppEnv>({ defaultHook: (result, c) => {
    if (!result.success) {
      // A route's own sentence ("Invalid shared filter. Choose with-me, by-me, or none.") already names the field and stays
      // as written; only zod's generic defaults ("Required", "Invalid input: expected string, received undefined", "Too small")
      // get the field name in front, so a person can tell which field is wrong.
      const generic = /^(Required\b|Invalid (input|option|string|number|date|email|url|uuid|literal|enum value)\b|Expected |Too (small|big)\b|Unrecognized key|String must|Number must)/;
      const message = result.error.issues.map((issue) => {
        const path = issue.path.filter((part) => part !== "body").join(".");
        return path && generic.test(issue.message) ? `${path}: ${issue.message}` : issue.message;
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
