// SHELL-SEARCH-02 (docs/plans/shell-search-2026-09-23.md): one typed
// route over the provider registry. Results are pointers into pages
// Home already has (`href`), never the records themselves - the wire
// carries no shape the spec already declares and nothing a child must
// not see. Additive from day one (org rule, Compatibility): the Go
// client renders the same route later.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { SEARCH_PROVIDERS } from "@/lib/search/providers";

export const searchRoutes = apiRouter();

const SearchResultSchema = z.object({
  kind: z.string(),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  href: z.string(),
});

const SearchGroupSchema = z.object({
  kind: z.string(),
  heading: z.string(),
  results: z.array(SearchResultSchema),
});

const searchRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Search"],
  summary: "The header's one global search - conversations, people, apps, settings",
  middleware: [requireAuth] as const,
  request: {
    query: z.object({
      q: z.string().min(1).openapi({ param: { name: "q", in: "query" }, example: "peo" }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ groups: z.array(SearchGroupSchema) }) } }, description: "One group per kind that matched, empty groups left out." },
    ...errorResponses({ 400: "Missing or empty q", 401: "Not signed in" }),
  },
});
searchRoutes.openapi(searchRoute, async (c) => {
  const actor = c.get("person");
  const { q } = c.req.valid("query");
  // A code review caught this: `z.string().min(1)` passes a single
  // space, and every provider's own `.trim().toLowerCase()` then
  // normalizes it to the empty string - `"".includes("")` is always
  // true, so a whitespace-only query silently returned every person,
  // every app, every non-expert setting, and the actor's own every
  // conversation instead of the "no match" the design's own "empty
  // groups left out" rule promises. Checked once here, not once per
  // provider - the same "one definition" reasoning the providers
  // themselves already follow for their own data.
  if (q.trim().length === 0) return c.json({ groups: [] }, 200);
  const settled = await Promise.allSettled(SEARCH_PROVIDERS.map((provider) => provider.search(q, actor)));
  const groups = SEARCH_PROVIDERS.map((provider, i) => {
    const outcome = settled[i]!;
    // A provider that throws is dropped from the response with a
    // warning in the log, never a failed request (the design's own
    // rule) - one broken provider (a bad query, a store temporarily
    // down) never takes the other three's real results down with it.
    if (outcome.status === "rejected") {
      console.warn(`[search] provider ${provider.kind} failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      return null;
    }
    return outcome.value.length > 0 ? { kind: provider.kind, heading: provider.heading, results: outcome.value } : null;
  }).filter((g): g is NonNullable<typeof g> => g !== null);
  return c.json({ groups }, 200);
});
