// SHELL-SEARCH-02 (docs/plans/shell-search-2026-09-23.md): one typed
// route over the provider registry. Results are pointers into pages
// Home already has (`href`), never the records themselves - the wire
// carries no shape the spec already declares and nothing a child must
// not see. Additive from day one (org rule, Compatibility): the Go
// client renders the same route later.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { SEARCH_PROVIDERS, rankGroups } from "@/lib/search/providers";
import { getHouseholdSettingValue } from "@/lib/settings";
import { clearSearchAddress, testOrSaveSearchAddress } from "@/lib/searchAddressSave";
import { webSourcesPicked } from "@/lib/retrieval/webSources";
import { ddgsConfigured } from "@/lib/retrieval/ddgsConfig";
import { SearchTestSummarySchema, summarizeSearchStatus } from "@/lib/searchTestSummary";
import { buildSearchInstanceSnippet, checkSearchInstance, SearchInstanceRefreshCooldownError } from "@/lib/searchInstanceCheck";
import { getStackClient } from "@/lib/stackEngine";
import { classifyStackError, STACK_ERROR_RESPONSES } from "@/lib/stack/httpErrors";

export const searchRoutes = apiRouter();

const SearchResultSchema = z.object({
  kind: z.string(),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  href: z.string(),
  match: z.tuple([z.number(), z.number()]).optional().describe("[start, end) of the first match in title, for highlighting."),
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
  return c.json({ groups: rankGroups(groups, q) }, 200);
});

const SearchCheckSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.enum(["pass", "warn", "fail", "unknown"]),
  detail: z.string(),
  fix: z.string().nullable(),
});
const SearchInstanceStatusSchema = z.object({
  mode: z.enum(["off", "owner", "stack"]),
  checkedAt: z.string(),
  version: z.string().nullable(),
  checks: z.array(SearchCheckSchema),
  groups: z.array(z.object({ id: z.string(), label: z.string(), enabledEngines: z.array(z.string()), state: z.enum(["pass", "warn", "fail", "unknown"]) })),
  engineErrors: z.array(z.object({ name: z.string(), percentage: z.number() })),
  /** Additive: the plain-words verdict and recommendation for the Web search page. */
  summary: SearchTestSummarySchema.optional(),
});

const instanceRoute = createRoute({
  method: "get",
  path: "/instance",
  tags: ["Search"],
  summary: "Check the household SearXNG configuration",
  description: "Owner/admin only. The address, engine list and check details are household operational information.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { query: z.object({ refresh: z.enum(["1"]).optional().openapi({ param: { name: "refresh", in: "query" } }) } ) },
  responses: {
    200: { content: { "application/json": { schema: SearchInstanceStatusSchema } }, description: "The latest check results." },
    429: { content: { "application/json": { schema: z.object({ error: z.string(), retryAfterSeconds: z.number() }) } }, description: "A manual refresh was requested during its cooldown." },
    ...errorResponses({ 403: "Only the owner or an admin may check SearXNG" }),
  },
});
searchRoutes.openapi(instanceRoute, async (c) => {
  const refresh = c.req.valid("query").refresh === "1";
  try {
    const status = await checkSearchInstance({ force: refresh, respectCooldown: refresh });
    const address = String(getHouseholdSettingValue("search.searxng_url") ?? "").trim();
    return c.json(status.mode === "owner" ? { ...status, summary: summarizeSearchStatus(status, address) } : status, 200);
  } catch (error) {
    if (error instanceof SearchInstanceRefreshCooldownError) {
      return c.json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }, 429);
    }
    throw error;
  }
});

const snippetRoute = createRoute({
  method: "get",
  path: "/instance/snippet",
  tags: ["Search"],
  summary: "Get the SearXNG settings snippet for the failing checks",
  description: "Owner/admin only. Returns only recommended settings for an owner-run SearXNG; never includes its address or secret key.",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ settingsYml: z.string(), limiterToml: z.string().nullable() }) } }, description: "Recommended changes for settings.yml and, when needed, limiter.toml." },
    ...errorResponses({ 403: "Only the owner or an admin may view the snippet", 404: "No owner-run SearXNG is configured" }),
  },
});
searchRoutes.openapi(snippetRoute, async (c) => {
  const status = await checkSearchInstance();
  if (status.mode !== "owner") return c.json({ error: "No owner-run SearXNG is configured" }, 404);
  return c.json(buildSearchInstanceSnippet(status), 200);
});

const stackProxyResponses = {
  200: { content: { "application/json": { schema: z.record(z.string(), z.unknown()) } }, description: "The Stack search settings operation result." },
  ...errorResponses({ 403: "Only the owner or an admin may change Stack search settings", 404: "Stack-owned search is not available" }),
  ...STACK_ERROR_RESPONSES,
};

const previewRoute = createRoute({
  method: "get",
  path: "/instance/preview",
  tags: ["Search"],
  summary: "Preview pending Stack-owned SearXNG settings",
  middleware: [requireRole("owner", "admin")] as const,
  responses: stackProxyResponses,
});
searchRoutes.openapi(previewRoute, async (c) => {
  if ((await checkSearchInstance()).mode !== "stack") return c.json({ error: "Stack-owned search is not available" }, 404);
  try {
    return c.json(await getStackClient().searchPreview(), 200);
  } catch (error) {
    const failure = classifyStackError(error);
    return c.json(failure.body, failure.status);
  }
});

const applyRoute = createRoute({
  method: "post",
  path: "/instance/apply",
  tags: ["Search"],
  summary: "Apply pending Stack-owned SearXNG settings",
  middleware: [requireRole("owner", "admin")] as const,
  responses: stackProxyResponses,
});
searchRoutes.openapi(applyRoute, async (c) => {
  if ((await checkSearchInstance()).mode !== "stack") return c.json({ error: "Stack-owned search is not available" }, 404);
  try {
    const stack = getStackClient();
    const { settings } = await stack.settings();
    const pendingSearchValues = Object.fromEntries(settings
      .filter((setting) => setting.key.startsWith("stack.search.") && setting.pending !== null)
      .map((setting) => [setting.key, setting.pending]));
    const result = await stack.applySettings(pendingSearchValues);
    return c.json(result as Record<string, unknown>, 200);
  } catch (error) {
    const failure = classifyStackError(error);
    return c.json(failure.body, failure.status);
  }
});

const revertRoute = createRoute({
  method: "post",
  path: "/instance/revert",
  tags: ["Search"],
  summary: "Undo applied Stack-owned SearXNG settings",
  middleware: [requireRole("owner", "admin")] as const,
  responses: stackProxyResponses,
});
searchRoutes.openapi(revertRoute, async (c) => {
  if ((await checkSearchInstance()).mode !== "stack") return c.json({ error: "Stack-owned search is not available" }, 404);
  try {
    return c.json(await getStackClient().searchRevert(), 200);
  } catch (error) {
    const failure = classifyStackError(error);
    return c.json(failure.body, failure.status);
  }
});

// SEARXNG-SET-05: Settings > Home > Search > Web search. Owner and admin only (the address and the sources are household
// operational information; a person at any age band who is not an owner or admin gets 403).
const webSettingsRoute = createRoute({
  method: "get",
  path: "/web",
  tags: ["Search"],
  summary: "What web search uses right now",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({
      address: z.string(),
      /** Whether the address answered at the last check; null when there is no address or no check could run. */
      works: z.boolean().nullable(),
      /** Home runs its own search service and no address is set. */
      stackOwned: z.boolean(),
      sources: z.array(z.enum(["searxng", "ddgs"])),
      ddgsReady: z.boolean(),
    }) } }, description: "The saved address, whether it works, the picked sources and whether DuckDuckGo is set up." },
    ...errorResponses({ 403: "Only the owner or an admin may see web search settings" }),
  },
});
searchRoutes.openapi(webSettingsRoute, async (c) => {
  const address = String(getHouseholdSettingValue("search.searxng_url") ?? "").trim();
  let works: boolean | null = null;
  let stackOwned = false;
  try {
    const status = await checkSearchInstance();
    stackOwned = status.mode === "stack" && address === "";
    if (address && status.mode === "owner") {
      // "Works" is whether it answers; a paced or unfinished check says nothing either way.
      const reach = status.checks.find((check) => check.id === "reachability")?.state;
      works = reach === "pass" ? true : reach === "fail" ? false : null;
    }
  } catch { /* an unreadable check leaves works unknown; the page says so in words */ }
  return c.json({ address, works, stackOwned, sources: webSourcesPicked(), ddgsReady: ddgsConfigured() }, 200);
});

const webAddressRoute = createRoute({
  method: "post",
  path: "/address",
  tags: ["Search"],
  summary: "Test, save or remove the SearXNG address",
  description: "Owner/admin only. dry_run tests without saving. An empty url removes SearXNG. Same host rules and checks as the setup screen.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ url: z.string(), dry_run: z.boolean().optional() }).strict() } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ saved: z.boolean(), cleared: z.boolean().optional(), result: SearchTestSummarySchema.optional() }) } }, description: "A Test answers with result and saved false; a Save answers saved true; an empty url removes SearXNG (cleared true)." },
    400: { content: { "application/json": { schema: z.object({ error: z.string(), next: z.string().optional() }) } }, description: "The address is not allowed, or a Save found the service not usable." },
    ...errorResponses({ 403: "Only the owner or an admin may change web search" }),
  },
});
searchRoutes.openapi(webAddressRoute, async (c) => {
  const { url, dry_run: dryRun } = c.req.valid("json");
  if (url.trim() === "") {
    if (dryRun) return c.json({ error: "Type the SearXNG address first, then press Test." }, 400);
    const cleared = clearSearchAddress();
    if (!cleared.ok) return c.json({ error: cleared.error }, 400);
    await checkSearchInstance({ force: true }).catch(() => undefined);
    return c.json({ saved: true, cleared: true }, 200);
  }
  const outcome = await testOrSaveSearchAddress(url, dryRun === true);
  if (outcome.kind === "refused") return c.json({ error: outcome.error, ...(outcome.next ? { next: outcome.next } : {}) }, 400);
  if (outcome.kind === "tested") return c.json({ saved: false, result: outcome.result }, 200);
  await checkSearchInstance({ force: true }).catch(() => undefined);
  return c.json({ saved: true }, 200);
});
