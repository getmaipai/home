import type { TurnGeneration, TurnNodeExecution, TurnStats } from "@/wire";

export interface TraceSpan {
  id: string;
  name: string;
  depth: number;
  startMs: number;
  durationMs: number;
  status: "running" | "completed" | "failed";
}

function nodeStatus(node: TurnNodeExecution): TraceSpan["status"] {
  if ("skipped" in node.outcome) return "completed";
  if (!node.outcome.ok) return "failed";
  return "completed";
}

function generationStatus(generation: TurnGeneration): TraceSpan["status"] {
  return generation.error ? "failed" : "completed";
}

export function makeTurnTrace(stats: TurnStats | null, minor: boolean, outcomesJson: string | null): { spans: TraceSpan[]; totalMs: number } {
  const nodes = stats?.nodes ?? [];
  const origins = nodes.map((node) => node.startMs).filter(Number.isFinite);
  const origin = origins.length ? Math.min(...origins) : 0;
  const spans: TraceSpan[] = nodes.map((node, index) => {
    const code = !minor && "ok" in node.outcome && !node.outcome.ok ? ` · ${node.outcome.code}` : "";
    return {
      id: `node-${index}`,
      name: `${node.node} · ${node.impl} v${node.version}${code}${"skipped" in node.outcome ? " · skipped" : ""}`,
      depth: 0,
      startMs: Math.max(0, node.startMs - origin),
      durationMs: Math.max(0, node.endMs - node.startMs),
      status: nodeStatus(node),
    };
  });

  for (const [index, generation] of (stats?.generations ?? []).entries()) {
    const startMs = Math.max(0, generation.request_sent_ms);
    const endMs = generation.first_delta_ms ?? (generation.predicted_ms == null ? startMs : startMs + generation.predicted_ms);
    spans.push({ id: `generation-${index}`, name: `Generation ${index + 1}`, depth: 1, startMs, durationMs: Math.max(0, endMs - startMs), status: generationStatus(generation) });
  }

  if (outcomesJson) {
    let outcomes: unknown;
    try { outcomes = JSON.parse(outcomesJson); } catch { outcomes = null; }
    if (Array.isArray(outcomes)) {
      outcomes.forEach((value: unknown, index: number) => {
        if (!value || typeof value !== "object") return;
        const item = value as { packageId?: unknown; status?: unknown; durationMs?: unknown; at?: unknown };
        if (typeof item.durationMs !== "number" || !Number.isFinite(item.durationMs) || typeof item.at !== "string") return;
        const end = Date.parse(item.at);
        if (!Number.isFinite(end)) return;
        const startMs = Math.max(0, end - item.durationMs - origin);
        const status = item.status === "pending" ? "running" : item.status === "succeeded" ? "completed" : "failed";
        spans.push({ id: `tool-${index}`, name: `Tool ${index + 1}`, depth: 1, startMs, durationMs: Math.max(0, item.durationMs), status });
      });
    }
  }

  const totalMs = Math.max(0, ...spans.map((span) => span.startMs + span.durationMs));
  return { spans, totalMs };
}
