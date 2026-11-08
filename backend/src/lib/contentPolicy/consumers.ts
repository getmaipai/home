import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { createContentPolicyResolver, type ContentPolicy } from "@/lib/contentPolicy";
import { getHouseholdSettingValue } from "@/lib/settings";

export const CHAT_OUTPUT_POLICY_KEY = "content.policy.chat_output";
export const SEARCH_POLICY_KEY = "content.policy.search";

export type PolicyLane = "chat_output" | "search";
export interface EnabledPolicy {
  readonly policy: ContentPolicy | null;
  readonly check: (text: string) => ReturnType<ContentPolicy["check"]>;
}

/** Read failures close the new lane. The check itself is synchronous and has no I/O. */
export function policyForConsumer(person: PersonRow, lane: PolicyLane, band?: AgeBand, readers: { household?: (key: string) => unknown } = {}): EnabledPolicy {
  const off: EnabledPolicy = { policy: null, check: () => null };
  const subjectBand: AgeBand = band ?? (person.role === "child" ? "child" : person.role === "teen" || person.role === "guest" ? "teen" : "adult");
  // RULES.md rules 0 and 10: an adult's content is the model's decision. No adult gets a content filter here, read errors included.
  if (subjectBand === "adult") return off;
  let enabled = true;
  try {
    enabled = (readers.household ?? getHouseholdSettingValue)(lane === "chat_output" ? CHAT_OUTPUT_POLICY_KEY : SEARCH_POLICY_KEY) === true;
  } catch { enabled = true; }
  if (!enabled) return off;
  // A minor's added filters (content.filters) are slice 05; until then only the band defaults apply, which a read cannot weaken.
  const policy = createContentPolicyResolver({ readFilters: () => [] }).contentPolicyFor({ actor: person, band: subjectBand, present: [], surface: "chat", surfaceClass: "written", spoken: false });
  return { policy, check: (text) => policy.check(text, "transcript") };
}
