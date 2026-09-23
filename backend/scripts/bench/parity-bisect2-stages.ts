// PARITY-BISECT-02's own pure stage-building logic (dev.md's
// PARITY-BISECT-01 finding: the collapse happens entirely inside the
// stable system prefix, before the tools block, the volatile message,
// or CHAT_SAMPLING are ever added). Split from parity-bisect2.ts for
// the same reason parity-bisect-stages.ts is: no `import "./setup"` at
// module scope, so a test can import buildStages2() directly.
//
// Every real fragment is imported from its own module, never re-typed
// here - identityLine/STABLE_SYSTEM_SUFFIX (turnEngine.ts) and
// FORMALITY_FRAGMENT_WRITTEN/COMPLEXITY_FRAGMENT/
// ENGAGEMENT_FRAGMENT_WRITTEN/FILLER_FRAGMENT/WRITTEN_POLICY/
// INFORMATION_HANDLING_POLICY (persona.ts) were exported for exactly
// this bench.
//
// Stages b through i follow buildStablePrefix's own real order exactly
// (identity, the suffix, the four dial fragments in composePersonaPrompt's
// own order, the information policy, WRITTEN_POLICY) - each fragment its
// own stage, per Fable's own refinement, rather than folding
// STABLE_SYSTEM_SUFFIX or INFORMATION_HANDLING_POLICY into "the rest".
import type { LlmMessage, LlmCompleteOptions } from "@/lib/llm";
import {
  type Persona,
  FORMALITY_FRAGMENT_WRITTEN,
  COMPLEXITY_FRAGMENT,
  ENGAGEMENT_FRAGMENT_WRITTEN,
  FILLER_FRAGMENT,
  WRITTEN_POLICY,
  INFORMATION_HANDLING_POLICY,
  composePersonaPrompt,
} from "@/lib/persona";
import { identityLine, STABLE_SYSTEM_SUFFIX } from "@/lib/turnEngine";

export const QUESTION = "how does a prompt cache make a language model faster and why does that matter";
// Matches PARITY-BISECT-01's own floor convention: the engine's own
// documented default (llama-server's own 0.8), never CHAT_SAMPLING -
// this bench isolates the prefix's own fragments, not sampling.
export const ENGINE_DEFAULT_TEMPERATURE = 0.8;

export interface Stage2 {
  name: string;
  messages: LlmMessage[];
  opts: LlmCompleteOptions;
}

// Every PARITY-BISECT-02 stage carries a real system message - the
// zero-system-message case is PARITY-BISECT-01's own floor row
// (already measured, reused here as REFERENCE_FLOOR_AVG in
// parity-bisect2.ts), never rebuilt here.
function stage(name: string, systemContent: string): Stage2 {
  return { name, messages: [{ role: "system", content: systemContent }, { role: "user", content: QUESTION }], opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false } };
}

/** Pure: builds every PARITY-BISECT-02 stage's own request, no live
 * call - a control, then buildStablePrefix's own eight pieces added
 * one at a time in its own real order, then two swaps against the
 * complete real prefix (buildStablePrefix() itself, byte-identical to
 * PARITY-BISECT-01's own "1-stable-prefix" stage and to stage i here). */
export function buildStages2(persona: Persona): Stage2[] {
  const identity = identityLine(persona);
  const withSuffix = `${identity} ${STABLE_SYSTEM_SUFFIX}`;
  const withFormality = `${withSuffix} ${FORMALITY_FRAGMENT_WRITTEN[persona.formality]}`;
  const withComplexity = `${withFormality} ${COMPLEXITY_FRAGMENT[persona.complexity]}`;
  const withEngagement = `${withComplexity} ${ENGAGEMENT_FRAGMENT_WRITTEN[persona.engagement]}`;
  const withFiller = `${withEngagement} ${FILLER_FRAGMENT[persona.filler_density]}`;
  const withInfoPolicy = `${withFiller} ${INFORMATION_HANDLING_POLICY}`;
  const fullPrefix = `${withInfoPolicy} ${WRITTEN_POLICY}`;

  // The two swaps: the complete real prefix with exactly one fragment
  // removed, everything else in buildStablePrefix's own real order and
  // real text - never a hand-rebuilt approximation of the whole thing.
  // "Description" here is Fable's own term (stage c above, "+ the
  // persona description lines") for STABLE_SYSTEM_SUFFIX specifically -
  // the "you know a lot about the world..." lines - never the persona's
  // own formality/complexity/engagement/filler dials (composePersonaPrompt,
  // kept intact in this swap; swap-no-formality is the one that drops a
  // dial).
  const companionWithoutFormality = [COMPLEXITY_FRAGMENT[persona.complexity], ENGAGEMENT_FRAGMENT_WRITTEN[persona.engagement], FILLER_FRAGMENT[persona.filler_density]].join(" ");
  const swapNoFormality = `${identity} ${STABLE_SYSTEM_SUFFIX} ${companionWithoutFormality} ${INFORMATION_HANDLING_POLICY} ${WRITTEN_POLICY}`;
  const swapNoDescription = `${identity} ${composePersonaPrompt(persona, "written")} ${INFORMATION_HANDLING_POLICY} ${WRITTEN_POLICY}`;

  return [
    stage("a-control-helpful-assistant", "You are a helpful assistant."),
    stage("b-identity-alone", identity),
    stage("c-plus-suffix", withSuffix),
    stage("d-plus-formality", withFormality),
    stage("e-plus-complexity", withComplexity),
    stage("f-plus-engagement", withEngagement),
    stage("g-plus-filler", withFiller),
    stage("h-plus-info-policy", withInfoPolicy),
    stage("i-plus-written-policy-full-prefix", fullPrefix),
    stage("swap-no-formality", swapNoFormality),
    stage("swap-no-description", swapNoDescription),
  ];
}

