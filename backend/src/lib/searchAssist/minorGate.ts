// MINOR-SEARCH-01i: the two facts a child's or teen's turn must show before
// the search assist scores it. Both are dry runs of what the policy node
// decides for a websearch call; neither reads text or stores anything.
import { decide } from "@/lib/gate/decide";
import { loadManifestOnly } from "@/lib/plugins";
import { webSourcesFor } from "@/lib/retrieval/webSources";
import type { Role } from "@/middleware/auth";
import type { TurnState } from "@/lib/turnMachine/contract";
import { speakerIsAnonymous, turnAgeBand } from "@/lib/turnMachine/speaker";

type GateState = Pick<TurnState, "surface" | "actor" | "speakerEvidence" | "crisis" | "deviceId">;

/** Whether the websearch package may run for this person at this band: the same policy decision the turn's policy node
 * makes. Fails closed on any throw or missing manifest. The search palette's Web tab asks it too (WEB-TAB-01). */
export function websearchGateAllows(who: { personId: string; role: Role; band: "child" | "teen" | "adult"; anonymous: boolean }, ctx: { crisis: boolean; temporary: boolean }): boolean {
  try {
    const loaded = loadManifestOnly("websearch");
    if (!loaded.ok) return false;
    const manifest = loaded.value;
    const gate = decide({
      who,
      what: { capabilities: manifest.permissions ?? [], summary: "Search the web for this request.", consequential: manifest.consequential, minRole: manifest.min_role },
      context: ctx,
    });
    return gate.kind === "allow" || gate.kind === "allow_with_limits";
  } catch {
    return false;
  }
}

/** Fails closed: any throw, missing manifest or non-allow means false. */
export function minorSearchGate(state: GateState, temporary: boolean): { gateAllows: boolean; webOn: boolean } {
  try {
    const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId);
    if (band === "adult") return { gateAllows: false, webOn: false };
    const gateAllows = websearchGateAllows({ personId: state.actor.id, role: state.actor.role as Role, band, anonymous: speakerIsAnonymous(state) }, { crisis: state.crisis, temporary });
    return { gateAllows, webOn: webSourcesFor(band, temporary).length > 0 };
  } catch {
    return { gateAllows: false, webOn: false };
  }
}
