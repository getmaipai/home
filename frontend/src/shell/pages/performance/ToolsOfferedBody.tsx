import { i18n } from "@lingui/core";
import type { PerformanceTurns } from "@/lib/api";
import { formatNumber } from "@/lib/format";

/** AUDIT-TOOLS-01: how much tool schema the model was handed on a turn (`stats.tools_offered`, recorded by the turn machine's
 * budget). Characters, not tokens: about four characters make a token. Admin-only, like the rest of this page. */
export function ToolsOfferedBody({ offered }: { offered: PerformanceTurns["tools_offered"] }) {
  if (offered.turns === 0) return <p className="text-sm text-muted-foreground">{i18n._({ id: "No turn in this window has recorded its tools yet.", message: "No turn in this window has recorded its tools yet." })}</p>;
  const chars = (n: number | null) => (n === null ? "-" : formatNumber(n));
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label={i18n._({ id: "Tools offered per turn", message: "Tools offered per turn" })}>
      <dt className="text-muted-foreground">{i18n._({ id: "Turns measured", message: "Turns measured" })}</dt>
      <dd>{offered.turns}</dd>
      <dt className="text-muted-foreground">{i18n._({ id: "Tools per turn (median)", message: "Tools per turn (median)" })}</dt>
      <dd>{offered.median_count ?? "-"}</dd>
      <dt className="text-muted-foreground">{i18n._({ id: "Schema characters (median)", message: "Schema characters (median)" })}</dt>
      <dd>{chars(offered.median_chars)}</dd>
      <dt className="text-muted-foreground">{i18n._({ id: "Schema characters (p95)", message: "Schema characters (p95)" })}</dt>
      <dd>{chars(offered.p95_chars)}</dd>
      <dt className="text-muted-foreground">{i18n._({ id: "Schema characters (largest)", message: "Schema characters (largest)" })}</dt>
      <dd>{chars(offered.max_chars)}</dd>
    </dl>
  );
}
