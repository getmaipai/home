// MINOR-SEARCH-01i: the two facts a child's or teen's turn must show before
// the search assist scores it. Both are dry runs of what the policy node
// decides for a websearch call; neither reads text or stores anything.
import { decide } from "@/lib/gate/decide";
import { loadManifestOnly } from "@/lib/plugins";
import { webSourcesFor } from "@/lib/retrieval/webSources";
import type { Role } from "@/middleware/auth";
import type { TurnState } from "@/lib/turnMachine/contract";
import { speakerIsAnonymous, turnAgeBand } from "@/lib/turnMachine/speaker";

type GateState = Pick<TurnState, "surface" | "actor" | "speakerEvidence" | "crisis">;

/** Fails closed: any throw, missing manifest or non-allow means false. */
export function minorSearchGate(state: GateState, temporary: boolean): { gateAllows: boolean; webOn: boolean } {
  try {
    const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date());
    if (band === "adult") return { gateAllows: false, webOn: false };
    const loaded = loadManifestOnly("websearch");
    if (!loaded.ok) return { gateAllows: false, webOn: false };
    const manifest = loaded.value;
    const gate = decide({
      who: { personId: state.actor.id, role: state.actor.role as Role, band, anonymous: speakerIsAnonymous(state) },
      what: { capabilities: manifest.permissions ?? [], summary: "Search the web for this request.", consequential: manifest.consequential, minRole: manifest.min_role },
      context: { crisis: state.crisis, temporary },
    });
    return { gateAllows: gate.kind === "allow" || gate.kind === "allow_with_limits", webOn: webSourcesFor(band, temporary).length > 0 };
  } catch {
    return { gateAllows: false, webOn: false };
  }
}
