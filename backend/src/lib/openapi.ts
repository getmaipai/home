// The @hono/zod-openapi scaffolding itself lives in
// @maipai/core/src/openapi now (core-v0.1.0, generic over the caller's
// own Hono Env instead of a hardcoded product type). Home's own
// apiRouter() below pins that generic to AppEnv once, here, so every
// existing call site keeps calling apiRouter() with no type argument.
import type { AppEnv } from "@/types";
import { apiRouter as apiRouterCore } from "@maipai/core/src/openapi";

export { ErrorSchema, errorResponses, idParamSchema, PaginationQuerySchema, paginatedResponseSchema } from "@maipai/core/src/openapi";

export function apiRouter() {
  return apiRouterCore<AppEnv>();
}
