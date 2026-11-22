// A personal coding key picks its tier by the model name the tool asks for: `maipai-coder` is Standard, `maipai-coder-boost` Boost, `maipai-coder-max` Max.
// The pick is only a request: it is checked against the person's grants and never raised (a session key keeps its own stored tier, see codingSessions.ts).
import { authorizeTier, readSlot, type Tier } from "@/lib/tiers";
import { TIER_NOT_OFFERED_LINE } from "@/lib/codingSessions";
import type { PersonRow } from "@/types";

export const CODER_MODEL_BY_TIER: Record<Tier, string> = { standard: "maipai-coder", boost: "maipai-coder-boost", max: "maipai-coder-max" };

/** The tier a model name asks for; any other name is Standard. */
export function tierFromModel(model: unknown): Tier {
  if (model === CODER_MODEL_BY_TIER.max) return "max";
  if (model === CODER_MODEL_BY_TIER.boost) return "boost";
  return "standard";
}

export type KeyTier = { ok: true; tier: Tier } | { ok: false; status: 403; code: "tier_not_granted" | "tier_not_offered"; message: string };

export function tierForPersonalKey(person: PersonRow, model: unknown): KeyTier {
  const requested = tierFromModel(model);
  if (requested === "standard") return { ok: true, tier: "standard" };
  const got = authorizeTier({ person, category: "coding", requested }).tier;
  if (got !== requested) return { ok: false, status: 403, code: "tier_not_granted", message: `Your access does not include ${requested === "max" ? "Max" : "Boost"} coding. Use the model name maipai-coder, or ask an admin to turn it on for you.` };
  if (readSlot("coding", requested).model === "off") return { ok: false, status: 403, code: "tier_not_offered", message: TIER_NOT_OFFERED_LINE };
  return { ok: true, tier: requested };
}
