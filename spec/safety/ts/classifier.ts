// The deterministic multi-signal classifier platform plan 4.3 requires:
// runs before any model, and again on every streamed sentence, with no
// model in the loop for the floor. Behaviorally this must eventually match
// a Python port on the robot (4.3: "It runs on the robot even when the hub
// answers"); that port is Robot v0.1 work (see spec/safety/README.md) and
// does not exist yet, so this file is written to stay language-portable
// (plain string matching, no TS-only tricks) even though only the TS side
// exists today.
import { SafetyResult } from "../../gen/ts/safety-result.js";
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

// Every category refuses except self_harm, derived from the generated
// schema's own enum rather than a hand-kept second list: a code review
// (2026-09-04) found this file hand-listing 7 of the 8 category strings,
// with nothing to catch drift if a 9th category is ever added.
const ALL_CATEGORIES = SafetyResult.shape.categories.element.options;
const REFUSE_CATEGORIES: ReadonlySet<Category> = new Set(
  ALL_CATEGORIES.filter((c) => c !== "self_harm"),
);

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
  // self_harm never blocks, even when another category also flags on the
  // same text (CLAUDE.md > Safety invariants: "Crisis resources: offer,
  // never block... not configurable off"). A code review (2026-09-04)
  // found the previous version treated ANY co-occurring refuse category
  // as overriding self_harm into a refuse, which is exactly what this
  // invariant forbids: a message showing self-harm intent must never lose
  // its crisis resources because it also tripped another detector.
  const hasSelfHarm = categories.includes("self_harm");
  const hasOtherRefuse = categories.some((c) => c !== "self_harm" && REFUSE_CATEGORIES.has(c));
  const action: SafetyResult["action"] = !flagged
    ? "allow"
    : hasSelfHarm
      ? "allow_with_resources"
      : hasOtherRefuse
        ? "refuse"
        : "allow_with_resources";

  return {
    flagged,
    categories,
    action,
    notify_parent: flagged && ctx.isMinor,
    matched_signals: matchedSignals,
    checked_at: new Date().toISOString(),
  };
}
