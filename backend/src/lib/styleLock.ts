// VIDEO-SETTINGS-02 (docs/design/settings-media-2026-11-02.md section 10): the Adult lock for the style lists that have no `Lora` record yet (the picture styles,
// which live in the Stack) and for the style rows of Models and storage. The owner's rule (2026-11-02): an adult-only style is one locked tile, with no name, size,
// trigger word, badge or id, until the person's own unlock proof is valid; a minor is not told a style exists. The decision is the same `lockState` every other
// locked surface uses, so there is one rule. Video styles read through `lib/loras/access.ts`.
import { lockState, requestProof, type AdultProof } from "@/lib/adultLock";
import { loraAccess } from "@/lib/loras/access";
import { getLoraRecord } from "@/lib/loras/store";
import { syncLoras } from "@/lib/loras/sync";
import { allAdapters } from "@/lib/pictures/adapters";
import type { PersonRow } from "@/types";

export type StyleAccess = "open" | "locked" | "hidden";

/** One picture style by its class. Anything not plainly "all-ages" counts as adult-only (the stricter class wins). */
export function pictureStyleAccess(actor: PersonRow, classification: string, proof: AdultProof = requestProof()): StyleAccess {
  if (classification === "all-ages") return "open";
  return lockState({ ownerPersonId: actor.id, madeAudience: "adult-only", lock: "on" }, actor, proof);
}

/** `lora.picture.<id>` or `lora.video.<id>` (the Stack's component ids of a household style), or null for any other part. */
export function styleOfComponent(componentId: string): { media: "picture" | "video"; id: string } | null {
  const m = /^lora\.(picture|video)\.(.+)$/.exec(componentId);
  return m ? { media: m[1] as "picture" | "video", id: m[2]! } : null;
}

/** What `actor` may see of the style behind a component id right now. A style Home cannot place (no record, not in the Stack's list) counts as locked: fail closed. */
export async function componentStyleAccess(actor: PersonRow, componentId: string, proof: AdultProof = requestProof()): Promise<StyleAccess> {
  const style = styleOfComponent(componentId);
  if (!style) return "open";
  if (style.media === "picture") {
    const found = (await allAdapters()).find((a) => a.id === style.id);
    return found ? pictureStyleAccess(actor, found.classification, proof) : pictureStyleAccess(actor, "unknown", proof);
  }
  await syncLoras().catch(() => undefined);
  const record = getLoraRecord(style.id);
  return record ? loraAccess(actor, record, "own_written", proof) : pictureStyleAccess(actor, "unknown", proof);
}
