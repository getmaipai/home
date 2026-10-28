// NAT-04 (docs/design/natural-speech-register-2026-10-27.md, section 3.5): a spoken form beside the exact
// value, so the model's easiest move is to repeat the way a person says it ("low seventies") rather than
// the number as printed ("72.4"). Built from typed fields with the one shared helper (@maipai/core sayRound),
// never from the person's words or the model's reply (chat rules 1 to 3). `exact: true` on the data
// suppresses it. Money stays exact: the policy keeps "money or an appointment time" out of rounding, so the
// currency package adopts nothing; a package with a distance or a duration adopts by adding a line below.

import { sayFor } from "@maipai/core/src/sayRound";
import type { ToolExecutionOutcome } from "@/lib/turnContext";

function numberOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The `say` map for one succeeded outcome, or null when its package has no adopted field or its data says `exact`. */
export function sayFields(outcome: ToolExecutionOutcome): Record<string, string> | null {
  if (outcome.status !== "succeeded") return null;
  const data = outcome.result?.data as Record<string, unknown> | undefined;
  if (!data || data.exact === true) return null;
  const out: Record<string, string> = {};
  if (outcome.packageId === "weather") {
    const unit = data.unit === "C" || data.unit === "F" ? data.unit : undefined;
    for (const key of ["temperature", "high", "low"] as const) {
      const n = numberOf(data[key]);
      const said = n === null ? null : sayFor("temperature", n, { exact: false, unit });
      if (said) out[key] = said;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
