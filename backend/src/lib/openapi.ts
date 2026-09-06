// The @hono/zod-openapi scaffolding (session-f-platform-and-trust.md step
// 4, getmaipai/.github/CLAUDE.md's Documentation section: "Hono routes
// defined with Zod schemas via @hono/zod-openapi... any route you touch
// gets converted to this style as part of touching it"). docs/dev.md's
// "API routes and @hono/zod-openapi (tracked debt)" note explains why
// this was deferred until now rather than converted piecemeal: no
// consumer read the generated spec until this wave's sessions need it.
//
// One factory (`apiRouter()`), not each route file hand-rolling its own
// `new OpenAPIHono()` with its own error-formatting hook - the same
// "one definition, one place" principle 4 already applies everywhere
// else. Every converted route file in this codebase creates its router
// through this function.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "@/types";

/** The wire shape of every hand-written `{ error: "..." }` response this
 * codebase already returns (routes/people.ts, routes/repairs.ts, and
 * every other route file, converted or not) - named so a converted
 * route's `responses` block can reference one real schema instead of a
 * copy of `z.object({ error: z.string() })` per file. */
export const ErrorSchema = z.object({ error: z.string() }).openapi("Error");

/** `createRoute`'s `responses` entries for this schema, at the given
 * status codes - saves every route definition repeating the identical
 * `{ content: { "application/json": { schema: ErrorSchema } }, description }`
 * shape for each of its error statuses.
 *
 * Generic over the literal status codes passed in (`<const T>`), not
 * annotated as the obvious-looking `Record<number, string>`: a first
 * version did that and it silently broke every route that spread this
 * into `responses` - @hono/zod-openapi derives a route's whole response
 * union from the LITERAL keys of its `responses` object, and a
 * `Record<number, ...>` return type erases them down to "some number,"
 * so a handler's `c.json(body, 404)` stopped type-checking against a
 * route that had genuinely declared 404 (caught while converting
 * routes/repairs.ts - the compiler pointed at the handler, but the bug
 * was here). */
export function errorResponses<const T extends Record<number, string>>(
  statuses: T,
): { [K in keyof T]: { content: { "application/json": { schema: typeof ErrorSchema } }; description: T[K] } } {
  const responses = {} as { [K in keyof T]: { content: { "application/json": { schema: typeof ErrorSchema } }; description: T[K] } };
  for (const key of Object.keys(statuses)) {
    const k = key as unknown as keyof T;
    responses[k] = { content: { "application/json": { schema: ErrorSchema } }, description: statuses[k] };
  }
  return responses;
}

/** A route's `request.params` schema for a single `{id}` path segment -
 * a code review (2026-09-06) found this exact shape
 * (`z.object({ id: z.string().openapi({ param: { name: "id", in: "path"
 * } }) })`) hand-declared separately in `repairs.ts`, `notifications.ts`,
 * `people.ts` and `backups.ts`'s `filename` param, instead of the one
 * shared place this kind of scaffolding belongs. `example` is optional
 * since a real id's shape (and worth showing one) varies by route -
 * pass it when the route has an obvious one (`issue-a1b2c3`), omit it
 * otherwise. Generic over the literal param name (`<const Name>`), the
 * identical reason `errorResponses()` above is generic over its literal
 * status keys: a plain `(paramName: string)` signature would make the
 * computed property key untypeable as anything but `string`, so
 * `c.req.valid("param").id` would come back as `string | undefined`
 * (an indexed-access lookup on a generic record) at every call site
 * instead of the guaranteed `string` a real path param always is. */
export function idParamSchema<const Name extends string>(paramName: Name, example?: string): z.ZodObject<{ [K in Name]: z.ZodString }> {
  const shape = { [paramName]: z.string().openapi({ param: { name: paramName, in: "path" }, ...(example ? { example } : {}) }) };
  return z.object(shape) as z.ZodObject<{ [K in Name]: z.ZodString }>;
}

/** `limit`/`cursor` query params for a route that lists a collection -
 * no route in this codebase paginates yet (every list is small enough to
 * return whole), but this is declared now so the first one that needs it
 * (D's store/catalog listings are the likely first real consumer) has a
 * shared shape to bind to instead of inventing its own query param
 * names. Optional on purpose: a route adopts pagination by adding this
 * to its `request.query`, not by every existing list route having to
 * grow one it doesn't need. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional().openapi({
    param: { name: "limit", in: "query" },
    example: 50,
  }),
  cursor: z.string().optional().openapi({
    param: { name: "cursor", in: "query" },
  }),
});

/** Wraps an item schema in the `{ items, next_cursor }` shape a paginated
 * list response uses once a route adopts `PaginationQuerySchema` -
 * `next_cursor` is `null` (not omitted) on the last page, so a client's
 * "is there more" check is one falsy test rather than an `in` check. */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    next_cursor: z.string().nullable(),
  });
}

/** Every converted route file's own `OpenAPIHono` instance goes through
 * this, not a bare `new OpenAPIHono()`: the `defaultHook` formats a Zod
 * validation failure as this codebase's own existing `{ error: "..." }`
 * shape at 400 (routes/people.ts's own `candidate.error.issues.map(...).
 * join("; ")` pattern, applied once here instead of by hand in every
 * route that used to call `.safeParse` itself) - a converted route's
 * error responses look identical to an unconverted one's, so a client
 * never has to branch on which routes happened to be converted yet. */
export function apiRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues.map((issue) => issue.message).join("; ");
        return c.json({ error: message }, 400);
      }
    },
  });
}
