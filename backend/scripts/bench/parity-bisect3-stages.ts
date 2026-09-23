// PARITY-BISECT-03's own pure stage-building logic, to Fable's own
// protocol (dev.md "BISECT-02 ruling", (3)): on the identity line
// alone (BISECT-02's own floor-holding base, byte-identical to the
// control), add each of the remaining six fragments ALONE, three reps
// each - never stacked cumulatively, so a fragment that only collapses
// in combination is told apart from one that collapses on its own -
// plus STABLE_SYSTEM_SUFFIX's own six sentences, each isolated the
// same way on the same identity-alone base.
//
// Split from parity-bisect3.ts for the same reason the earlier bisect
// stages files are: no `import "./setup"` at module scope, so a test
// can import buildStages3() directly.
import type { LlmMessage, LlmCompleteOptions } from "@/lib/llm";
import {
  type Persona,
  FORMALITY_FRAGMENT_WRITTEN,
  COMPLEXITY_FRAGMENT,
  ENGAGEMENT_FRAGMENT_WRITTEN,
  FILLER_FRAGMENT,
  WRITTEN_POLICY,
  INFORMATION_HANDLING_POLICY,
} from "@/lib/persona";
import { identityLine, STABLE_SYSTEM_SUFFIX_SENTENCES } from "@/lib/turnEngine";

export const QUESTION = "how does a prompt cache make a language model faster and why does that matter";
// Matches BISECT-01/02's own floor convention: the engine's own
// documented default (llama-server's own 0.8), never CHAT_SAMPLING.
export const ENGINE_DEFAULT_TEMPERATURE = 0.8;

export interface Stage3 {
  name: string;
  messages: LlmMessage[];
  opts: LlmCompleteOptions;
}

function stage(name: string, identity: string, fragment: string | null): Stage3 {
  const content = fragment !== null ? `${identity} ${fragment}` : identity;
  return { name, messages: [{ role: "system", content }, { role: "user", content: QUESTION }], opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false } };
}

/** Pure: builds every PARITY-BISECT-03 stage's own request, no live
 * call. One baseline (the identity line alone, re-measured here as
 * this bench's own reference), six fragment-alone stages (each of the
 * remaining stable-prefix pieces added to the baseline on its own,
 * never combined with another), then six suffix-sentence-alone stages
 * (each of STABLE_SYSTEM_SUFFIX's own six sentences, same treatment). */
export function buildStages3(persona: Persona): Stage3[] {
  const identity = identityLine(persona);
  const stages: Stage3[] = [stage("baseline-identity-alone", identity, null)];

  stages.push(stage("alone-complexity", identity, COMPLEXITY_FRAGMENT[persona.complexity]));
  stages.push(stage("alone-engagement", identity, ENGAGEMENT_FRAGMENT_WRITTEN[persona.engagement]));
  stages.push(stage("alone-filler", identity, FILLER_FRAGMENT[persona.filler_density]));
  stages.push(stage("alone-info-policy", identity, INFORMATION_HANDLING_POLICY));
  stages.push(stage("alone-written-policy", identity, WRITTEN_POLICY));
  // A length check only (dev.md's own framing) - the lowercase effect
  // is already confirmed (BISECT-02); this asks whether it is ALSO
  // independently sufficient to collapse length on its own.
  stages.push(stage("alone-formality", identity, FORMALITY_FRAGMENT_WRITTEN[persona.formality]));

  STABLE_SYSTEM_SUFFIX_SENTENCES.forEach((sentence, i) => {
    stages.push(stage(`alone-suffix-sentence-${i + 1}`, identity, sentence));
  });

  return stages;
}
