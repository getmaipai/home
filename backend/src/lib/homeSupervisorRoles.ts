// When Home has no Stack configured, report that dependency directly.
// There is no Home-owned model supervisor to report as a fallback.
import type { RoleInfo, RoleState } from "@/lib/stack/types";


function notInstalledRoleState(reason: string): RoleState {
  const now = new Date().toISOString();
  return { state: "notInstalled", since: now, checkedAt: now, reason };
}

const NO_CHECK = { state: "skipped" as const, at: null, reason: null, stale: false };

function chatRole(): RoleInfo {
  return {
    id: "chat", label: "Chat", wire: "chat", residency: "jit", endpoints: [], quality: [],
    sharesModelWith: null,
    state: { state: "offline", since: new Date().toISOString(), checkedAt: new Date().toISOString(), reason: "The MaiPai Stack is not configured." },
    reason: "The MaiPai Stack is not configured.", model: null, check: NO_CHECK,
  };
}

/** Nothing exists on the Home side for image generation yet (both
 * catalog entries in modelCatalog.ts are `implemented: false`, no
 * supervisor, no probe) - reported honestly as not installed rather
 * than omitted, so a caller iterating every role id gets a real answer
 * for all of them, the same "null, not silently missing" posture
 * dashboard.ts's own engineStatusCounts() already takes. */
function imageRole(): RoleInfo {
  return {
    id: "image",
    label: "Image generation",
    wire: "job",
    residency: "installed",
    endpoints: [],
    quality: [],
    sharesModelWith: null,
    state: notInstalledRoleState("No image-generation engine is implemented on this hub yet."),
    reason: "Not implemented on this hub yet.",
    model: null,
    check: NO_CHECK,
  };
}

/** `GET /api/engines`'s own roles source when no Stack is configured.
 * Chat uses the live probe `GET /api/health` already makes, so the two
 * routes cannot disagree about its state. Image is a
 * synchronous, side-effect-free read. STT belongs to the configured
 * Stack and is omitted when no Stack is configured. Nothing here ever
 * spawns anything, the same posture the route's Stack-configured path
 * already has. */
export async function getHomeSupervisorRoles(): Promise<RoleInfo[]> {
  return [chatRole(), imageRole()];
}
