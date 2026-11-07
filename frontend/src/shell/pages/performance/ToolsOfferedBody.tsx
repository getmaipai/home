import type { PerformanceTurns } from "@/lib/api";

/** AUDIT-TOOLS-01: how much tool schema the model was handed on a turn (`stats.tools_offered`, recorded by the turn machine's
 * budget). Characters, not tokens: about four characters make a token. Admin-only, like the rest of this page. */
export function ToolsOfferedBody({ offered }: { offered: PerformanceTurns["tools_offered"] }) {
  if (offered.turns === 0) return <p className="text-sm text-muted-foreground">No turn in this window has recorded its tools yet.</p>;
  const chars = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US"));
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="Tools offered per turn">
      <dt className="text-muted-foreground">Turns measured</dt>
      <dd>{offered.turns}</dd>
      <dt className="text-muted-foreground">Tools per turn (median)</dt>
      <dd>{offered.median_count ?? "-"}</dd>
      <dt className="text-muted-foreground">Schema characters (median)</dt>
      <dd>{chars(offered.median_chars)}</dd>
      <dt className="text-muted-foreground">Schema characters (p95)</dt>
      <dd>{chars(offered.p95_chars)}</dd>
      <dt className="text-muted-foreground">Schema characters (largest)</dt>
      <dd>{chars(offered.max_chars)}</dd>
    </dl>
  );
}
