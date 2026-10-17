import type { EnginesOverview } from "@/lib/api";

/** Shared by composerAddMenu.tsx and composerVoiceControls.tsx - a code
 * review (SHELL-02 slice 6) caught the same function defined verbatim
 * in both, a real drift risk if "ready" ever needs a second state
 * (HANDSFREE-01, e.g. treating `loaded` as usable). One definition. */
export function readyRole(overview: EnginesOverview | undefined, id: string): boolean {
  return Array.isArray(overview?.roles) && overview.roles.some((role) => role.id === id && role.state.state === "ready");
}

/** The live conversation button needs a role that is installed, loaded or
 * ready. Installed-not-loaded is a Stack that has not warmed the role yet, not
 * an unavailable one: the button stays and the first use warms it. Only
 * notInstalled, offline or an absent role hides it. One definition. */
export function usableRole(overview: EnginesOverview | undefined, id: string): boolean {
  return Array.isArray(overview?.roles) && overview.roles.some((role) => role.id === id && ["installed", "loaded", "ready"].includes(role.state.state));
}
