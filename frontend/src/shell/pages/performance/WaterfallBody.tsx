import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { TraceWaterfall, type TraceSpan } from "@maipai/ui/src/elements/trace-waterfall";
import { api, type WaterfallOffsets } from "@/lib/api";

/** TURN-WATERFALL-01: stages as spans from the offsets (ms from turn start). A stage with no measured end is left out. */
export function spansOf(o: WaterfallOffsets): { spans: TraceSpan[]; totalMs: number } {
  const marks: Array<[string, number | null]> = [
    [i18n._({ id: "Context build", message: "Context build" }), o.context_end_ms],
    [i18n._({ id: "Prefill", message: "Prefill" }), o.prefill_end_ms],
    [i18n._({ id: "First word", message: "First word" }), o.first_token_ms],
    [i18n._({ id: "First sentence", message: "First sentence" }), o.first_sentence_ms],
    [i18n._({ id: "First audio", message: "First audio" }), o.first_audio_ms],
  ];
  const spans: TraceSpan[] = [];
  let prev = 0;
  for (const [name, end] of marks) {
    if (end === null) continue;
    const start = Math.min(prev, end);
    spans.push({ id: name, name, depth: 0, startMs: start, durationMs: end - start, status: "completed" });
    prev = Math.max(prev, end);
  }
  return { spans, totalMs: Math.max(prev, o.total_ms ?? 0) };
}

export function WaterfallBody() {
  const query = useQuery({ queryKey: ["performance-waterfall"], queryFn: () => api.performanceWaterfall() });
  const data = query.data;
  if (!data) return <p className="text-body text-muted-foreground">{query.isError ? i18n._({ id: "Could not load reply timing.", message: "Could not load reply timing." }) : i18n._({ id: "Loading reply timing", message: "Loading reply timing" })}</p>;
  if (data.turns === 0 && data.recent.length === 0) return <p className="text-body text-muted-foreground">{i18n._({ id: "No replies timed yet.", message: "No replies timed yet." })}</p>;
  const rows = [
    { label: i18n._({ id: "Typical reply ({turns, plural, one {# recent reply} other {# recent replies}})", message: "Typical reply ({turns, plural, one {# recent reply} other {# recent replies}})", values: { turns: data.turns } }), offsets: data.median },
    ...data.recent.map((offsets, i) => ({ label: i18n._({ id: "Your reply {n} back", message: "Your reply {n} back", values: { n: i + 1 } }), offsets })),
  ].map((row) => ({ ...row, ...spansOf(row.offsets) }));
  return (
    <>
      {rows.map((row, i) => (
        <section key={i} className="mb-4 flex flex-col gap-1">
          <p className="text-body text-muted-foreground">{row.label}</p>
          {row.spans.length === 0
            ? <p className="text-body text-muted-foreground">{i18n._({ id: "No stage was timed for this reply.", message: "No stage was timed for this reply." })}</p>
            : <TraceWaterfall spans={row.spans} totalMs={row.totalMs} visibleCount={row.spans.length} />}
        </section>
      ))}
    </>
  );
}
