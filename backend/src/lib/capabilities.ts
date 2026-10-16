// CAP-GATE-01: the node's engine capabilities, derived in one place from the
// per-role allocation (`engines.<role>.choice`, "off" turns a role off) and the
// roles the install reported as failed. Every consumer reads this one answer:
// the skills list, the apps list and the catalog install.
import { getHouseholdSettingValue } from "@/lib/settings";

/** Engine role id to the capability the vocabulary names for it. Chat maps to
 * gpu_llm or cpu_llm and is never switched off here: a hub with no chat is
 * not a configuration this layer hides packages for. */
const ROLE_CAPABILITY: Record<string, string> = {
  embed: "embeddings", vision: "vision", image: "image", video: "video", music: "music", stt: "stt", tts: "tts",
};

/** Capabilities the allocation has turned off, or that failed to install. */
export function unavailableCapabilities(failedRoles: readonly string[] = []): Set<string> {
  const off = new Set<string>();
  for (const [role, capability] of Object.entries(ROLE_CAPABILITY)) {
    if (getHouseholdSettingValue(`engines.${role}.choice`) === "off" || failedRoles.includes(role)) off.add(capability);
  }
  return off;
}

type Declares = { requires?: readonly string[]; optional?: readonly string[] };

/** The required capabilities this manifest cannot run without right now. */
export function missingRequired(manifest: Declares, unavailable: Set<string> = unavailableCapabilities()): string[] {
  return (manifest.requires ?? []).filter((capability) => unavailable.has(capability));
}

/** Optional capabilities that are off: the package stays and runs degraded. */
export function missingOptional(manifest: Declares, unavailable: Set<string> = unavailableCapabilities()): string[] {
  return (manifest.optional ?? []).filter((capability) => unavailable.has(capability));
}

const WORDS: Record<string, string> = {
  embeddings: "Search of your notes", vision: "Photo understanding", image: "Pictures", video: "Video", music: "Music", stt: "Listening", tts: "Speaking",
};
export const capabilityWords = (capability: string): string => WORDS[capability] ?? capability;

/** The refusal a catalog install gets, in the words the person sees. */
export function installRefusal(id: string, manifest: Declares): string | null {
  const missing = missingRequired(manifest);
  if (missing.length === 0) return null;
  const first = missing[0]!;
  return `${id} needs ${capabilityWords(first)}, and ${capabilityWords(first)} is off on this home. Turn it on under Settings, Engines and AI, then install ${id} again.`;
}
