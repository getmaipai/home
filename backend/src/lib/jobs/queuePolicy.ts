// TIER-PRIO-02/06: the household queue's policy, read from the household settings at every ordering (resource-profiles note, sections 4 and 7).
// `resources.priority` is the order of importance (chat and voice always go first and are not in this queue), so it decides which of
// pictures, videos and songs goes first when their waits are equal; `resources.strict.*` puts a kind before every other, however long the others waited.
import { DEFAULT_POLICY, type JobCategory, type ScorePolicy } from "./jobScore";
import { weightsFromPriority } from "./profileSource";
import { setQueuePolicySource } from "./householdQueue";
import { getHouseholdSettingValue } from "@/lib/settings";

const KINDS = [["image", "picture"], ["video", "video"], ["music", "music"]] as const satisfies readonly (readonly [string, JobCategory])[];
/** Added to a strict kind's class weight: larger than any gap between the ordinary weights plus aging and fair share. */
export const STRICT_BONUS = 1000;

export function queuePolicyFromSettings(read: (key: string) => unknown): ScorePolicy {
  const classWeights = { ...DEFAULT_POLICY.classWeights };
  // The shipped weights for the three kinds are handed out in the admin's order, so the default order changes nothing.
  const slots = KINDS.map(([, category]) => DEFAULT_POLICY.classWeights[category]).sort((a, b) => b - a);
  const importance = weightsFromPriority(read("resources.priority"));
  const ordered = KINDS.map(([, category]) => category).sort((a, b) => (importance[b] ?? 0) - (importance[a] ?? 0) || KINDS.findIndex(([, c]) => c === a) - KINDS.findIndex(([, c]) => c === b));
  if (KINDS.every(([, category]) => importance[category] !== undefined)) ordered.forEach((category, index) => { classWeights[category] = slots[index]!; });
  const maxWaitBeforeAgingMinutes: Partial<Record<JobCategory, number>> = {};
  for (const [kind, category] of KINDS) {
    if (read(`resources.strict.${kind}`) === true) classWeights[category] += STRICT_BONUS;
    const wait = read(`resources.max_wait_before_aging.${kind}`);
    if (typeof wait === "number" && Number.isFinite(wait) && wait > 0) maxWaitBeforeAgingMinutes[category] = wait;
  }
  const limit = read("resources.max_concurrent_per_person");
  const maxConcurrentPerPerson = typeof limit === "number" && Number.isFinite(limit) ? Math.min(3, Math.max(1, Math.round(limit))) : DEFAULT_POLICY.maxConcurrentPerPerson;
  return { ...DEFAULT_POLICY, classWeights, maxConcurrentPerPerson, maxWaitBeforeAgingMinutes };
}

/** Called once at start: from now on the queue reads the household settings at every ordering, so a change on the Performance page applies to the next job. */
export function wireQueuePolicy(): void { setQueuePolicySource(() => queuePolicyFromSettings(getHouseholdSettingValue)); }
