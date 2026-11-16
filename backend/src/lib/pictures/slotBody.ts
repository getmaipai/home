// TIER-PIC-01: the saved slot of a picture level (`engines.image.tier.<tier>`) turned into the Stack request, read when the job is sent (the pattern of
// `videos/slotBody.ts` and `music/jobs.ts`). A changed pick applies to the next job at that level; a level switched off since the job was queued is
// sent one level lower; the body carries `tier` so the Stack opens its Max window, and the job record keeps the level it really ran at.
// Age gates ran before this and are not loosened: a person's band ceiling caps the level whatever the slots say (RULES.md rules 0 and 8).
import type { AgeBand } from "@/lib/ageBand";
import { bandCeiling, maxModel, MAX_NOT_ON_THIS_COMPUTER_LINE, slotRun, type Tier } from "@/lib/tiers";
import { DETAILED_MODEL, qualityOfModel, quickModelFor, type PictureQuality } from "./quality";
import type { GenerationBody, StackImageStatus } from "./stack";

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
export function pictureBodyForSlot(base: Body, requested: Tier, band: AgeBand, engine: Pick<StackImageStatus, "models"> | null = null): PictureSlotBody {
  const body: Body = { ...base };
  delete body.tier;
  const styled = (base.loras?.length ?? 0) > 0;
  const ceiling = bandCeiling(band, "image");
  let ask: Tier = LADDER.indexOf(requested) > LADDER.indexOf(ceiling) ? ceiling : requested;
  let line: string | null = null;
  let run = slotRun("image", ask, band);
  // Max runs only on a model that exists here, and never on a style made for another maker: otherwise it is made at Boost.
  if (run.tier === "max" && (!maxModel("image") || styled)) {
    if (!maxModel("image")) line = MAX_NOT_ON_THIS_COMPUTER_LINE;
    ask = "boost";
    run = slotRun("image", ask, band);
  }
  const tier = run.tier;
  const lowered = tier !== requested;
  if (tier === "max") body.model = run.model ?? maxModel("image")!;
  else if (tier === "boost") { if (!styled) body.model = run.model ?? DETAILED_MODEL; }
  else if (lowered && !styled && base.model === DETAILED_MODEL) {
    // Lowered from the Detailed maker: Standard's own maker is ERNIE when installed, else the Stack's default (Klein). A model chosen for Standard stays.
    const standard = quickModelFor(engine);
    if (standard) body.model = standard; else delete body.model;
  }
  if (tier === "boost" || tier === "max") body.tier = tier;
  const quality: PictureQuality = tier === "standard" ? qualityOfModel(body.model) ?? "quick" : "detailed";
  return { body, tier, lowered, line, quality };
}
