// ADMIN-PERF-01 (docs/BACKLOG.md, design note in docs/dev.md): thin
// zod-openapi wrapper, same shape as repairs.ts/engines.ts - all the
// aggregation lives in lib/performance.ts, this file only validates and
// gates. Owner/admin only: Health/Repairs and the Stack are already
// gated the identical way, and this page surfaces the same kind of
// machine-internal numbers.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { getPerformance } from "@/lib/performance";

export const performanceRoutes = apiRouter();

const TurnDaySchema = z.object({
  date: z.string(),
  count: z.number().int(),
  median_ttft_ms: z.number().nullable(),
  p95_ttft_ms: z.number().nullable(),
  median_total_ms: z.number().nullable(),
  p95_total_ms: z.number().nullable(),
  median_tokens_per_second: z.number().nullable(),
});

const EngineStatsSchema = TurnDaySchema.omit({ date: true }).extend({ engine: z.string() });

const TurnsSchema = z.object({
  window_days: z.number().int(),
  by_day: z.array(TurnDaySchema),
  by_engine: z.array(EngineStatsSchema),
  by_route: z.array(z.object({ route: z.string(), count: z.number().int() })),
});

const QueuesSchema = z.object({
  judge: z.object({ pending: z.number().int(), oldest_created_at: z.string().nullable() }),
  embedding: z.object({ pending: z.number().int() }),
  ingestion: z.object({ pending: z.number().int(), by_reason: z.array(z.object({ reason: z.string(), count: z.number().int() })) }),
});

const LabelsSchema = z.object({
  window_days: z.number().int(),
  turns: z.number().int(),
  guard_hits: z.array(z.object({ key: z.string(), count: z.number().int() })),
  rule_hits: z.array(z.object({ key: z.string(), count: z.number().int() })),
  rungs: z.array(z.object({ key: z.string(), count: z.number().int() })),
  retire_eligible: z.array(z.string()),
});

const LayersSchema = z.object({
  window_days: z.number().int(),
  turns_with_trace: z.number().int(),
  nodes: z.array(z.object({ node: z.string(), count: z.number().int(), median_ms: z.number().nullable(), p95_ms: z.number().nullable() })),
});

// Deliberately loose (z.record) for roles/engines/budget/hardware -
// routes/engines.ts's own schemas are the source of truth for those
// shapes; re-describing them here would drift the moment engines.ts
// changes. This route's own contract is the aggregation fields around
// them (recent_issues, configured), not the Stack's own payload shape.
const EnginesPanelSchema = z.object({
  configured: z.boolean(),
  roles: z.array(z.record(z.string(), z.unknown())),
  engines: z.array(z.record(z.string(), z.unknown())),
  budget: z.record(z.string(), z.unknown()).nullable(),
  recent_issues: z.array(z.object({ source: z.string(), key: z.string(), severity: z.string(), createdAt: z.string(), resolvedAt: z.string().nullable() })),
});

const HardwareSchema = z.object({ configured: z.boolean(), hardware: z.record(z.string(), z.unknown()).nullable() });

const DiskSchema = z.object({
  total_bytes: z.number(),
  free_bytes: z.number(),
  areas: z.array(z.object({ area: z.string(), bytes: z.number() })),
});

const PerformanceSchema = z.object({
  turns: TurnsSchema,
  queues: QueuesSchema,
  labels: LabelsSchema,
  layers: LayersSchema,
  engines: EnginesPanelSchema,
  hardware: HardwareSchema,
  disk: DiskSchema,
  retention_days: z.number().int(),
});

const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Performance"],
  summary: "The admin performance dashboard's one aggregate read",
  description: "Owner/admin only: how the hub is doing over time, aggregated from what it already records - turn stats, engine health, the memory/embedding queues, the label harvest, disk and hardware. No new collection.",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    query: z.object({
      days: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .openapi({ param: { name: "days", in: "query" }, description: "Window size, 1-90, default 30." }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: PerformanceSchema } }, description: "Real numbers, aggregated live - never a 500 for a missing Stack or an empty queue." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
performanceRoutes.openapi(getRoute, async (c) => {
  const raw = c.req.valid("query").days;
  const days = raw ? Number.parseInt(raw, 10) : undefined;
  return c.json(await getPerformance(days), 200);
});
