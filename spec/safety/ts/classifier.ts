// The deterministic multi-signal classifier platform plan 4.3 requires:
// runs before any model, and again on every streamed sentence, with no
// model in the loop for the floor. Behaviorally this must eventually match
// a Python port on the robot (4.3: "It runs on the robot even when the hub
// answers"); that port is Robot v0.1 work (see spec/safety/README.md) and
// does not exist yet, so this file is written to stay language-portable
// (plain string matching, no TS-only tricks) even though only the TS side
// exists today.
import type { SafetyResult } from "../../gen/ts/safety-result.js";
import {
  detectSelfHarm,
  detectHarmfulRequest,
  detectCredibleThreat,
  detectCsam,
  detectGrooming,
  detectPiiExtraction,
  detectPromptInjection,
  detectJailbreak,
  type SafetyContext,
} from "./signals.js";

export type { SafetyContext } from "./signals.js";

type Category = SafetyResult["categories"][number];

// self_harm never blocks (CLAUDE.md > Safety invariants: "Crisis
// resources: offer, never block... not configurable off"). Every other
// floor category refuses; nothing may lower this, including for the
// household's own admin (4.3, CLAUDE.md > Safety invariants).
const REFUSE_CATEGORIES: ReadonlySet<Category> = new Set([
  "harmful_request",
  "credible_threat",
  "csam",
  "grooming",
  "pii_extraction",
  "prompt_injection",
  "jailbreak",
]);

export function checkSafety(text: string, ctx: SafetyContext): SafetyResult {
  const results = [
    detectSelfHarm(text),
    detectHarmfulRequest(text),
    detectCredibleThreat(text),
    detectCsam(text),
    detectGrooming(text, ctx),
    detectPiiExtraction(text),
    detectPromptInjection(text),
    detectJailbreak(text),
  ];

  const categories: Category[] = [];
  const matchedSignals: string[] = [];
  for (const r of results) {
    if (r.matched.length > 0) {
      categories.push(r.category as Category);
      matchedSignals.push(...r.matched);
    }
  }

  const flagged = categories.length > 0;
  const action: SafetyResult["action"] = !flagged
    ? "allow"
    : categories.some((c) => REFUSE_CATEGORIES.has(c))
      ? "refuse"
      : "allow_with_resources"; // self_harm is the only category that can reach here alone

  return {
    flagged,
    categories,
    action,
    notify_parent: flagged && ctx.isMinor,
    matched_signals: matchedSignals,
    checked_at: new Date().toISOString(),
  };
}
