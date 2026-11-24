// TIER-PIC-01: the saved slot of a picture level (`engines.pictures.tier.<tier>`) turned into the Stack request, read when the job is sent (the pattern of
// `videos/slotBody.ts` and `music/jobs.ts`). A changed pick applies to the next job at that level; a level switched off since the job was queued is
// sent one level lower; the body carries `tier` so the Stack opens its Max window, and the job record keeps the level it really ran at.
// Age gates ran before this and are not loosened: the level the person's pass holds for pictures (`tier.boost:pictures`, `tier.max:pictures`) caps the level
// whatever the slots say (RULES.md C3, rules 0 and 8).
import { maxModel, MAX_NOT_ON_THIS_COMPUTER_LINE, slotRun, tierCeiling, type SlotReader, type Tier } from "@/lib/tiers";
import { isRemovedPictureModel, type PictureQuality } from "./quality";
import type { GenerationBody } from "./stack";

type Body = Omit<GenerationBody, "timeout_ms">;
const LADDER: readonly Tier[] = ["standard", "boost", "max"];

export interface PictureSlotBody {
  body: Body;
  /** The level the picture really runs at. */
  tier: Tier;
  /** It runs below the level it was queued at. */
  lowered: boolean;
  /** The sentence for a Max request that runs at Boost because Max has no model on this computer. */
  line: string | null;
  quality: PictureQuality;
}

/** The body to send for a picture queued at `requested`: the slot's model and the level applied. */
export function pictureBodyForSlot(base: Body, requested: Tier, reader: SlotReader): PictureSlotBody {
  const body: Body = { ...base };
  delete body.tier;
  const styled = (base.loras?.length ?? 0) > 0;
  const ceiling = tierCeiling(reader, "pictures");
  let ask: Tier = LADDER.indexOf(requested) > LADDER.indexOf(ceiling) ? ceiling : requested;
  let line: string | null = null;
  let run = slotRun("pictures", ask, reader);
  // Max runs only on a model that exists here, and never on a style made for another maker: otherwise it is made at Boost.
  if (run.tier === "max" && (!maxModel("pictures") || styled)) {
    if (!maxModel("pictures")) line = MAX_NOT_ON_THIS_COMPUTER_LINE;
    ask = "boost";
    run = slotRun("pictures", ask, reader);
  }
  const tier = run.tier;
  const lowered = tier !== requested;
  // A slot saved before the removal of ERNIE, Klein and Z-Image names a model that is gone: it is not sent. A slot the household chose is the household's
  // order (rule E5) and goes as the part to ask for; a level with no pick names nothing, and the Stack picks the part.
  const live = (model: string | null | undefined): string | undefined => (model && !isRemovedPictureModel(model) ? model : undefined);
  if (tier === "max") body.model = live(run.model) ?? maxModel("pictures")!;
  else if (tier === "boost") { if (!styled) { const picked = live(run.model); if (picked) body.model = picked; else delete body.model; } }
  else if (lowered && !styled) delete body.model;
  if (tier === "boost" || tier === "max") body.tier = tier;
  const quality: PictureQuality = tier === "standard" ? "quick" : "detailed";
  return { body, tier, lowered, line, quality };
}
