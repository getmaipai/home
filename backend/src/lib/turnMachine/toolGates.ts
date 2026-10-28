import type { PersonRow } from "@/types";
import type { Surface } from "@/lib/turnShared";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { AgeBand } from "@/lib/ageBand";
import { musicsAllowed } from "@/lib/music/policy";
import { musicEngineReady } from "@/lib/music/ready";
import { picturesAllowed } from "@/lib/pictures/policy";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { videosAllowed } from "@/lib/videos/policy";
import { videoEngineReady } from "@/lib/videos/ready";
import { itemRefsIn } from "@/lib/items/tool";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { withTurnToolGates } from "./budget";
import type { TurnBudget } from "./contract";

export interface TurnToolGateInput {
  budget: TurnBudget;
  actor: PersonRow;
  band: AgeBand;
  surface: Surface;
  surfaceClass: SurfaceClass;
  spoken: boolean;
  temporary: boolean;
  bare: boolean;
  ephemeral: boolean;
  text: string;
  musicEditAvailable: () => boolean;
}

export interface TurnToolGateResult {
  budget: TurnBudget;
  answerImagesOk: boolean;
  picturesOk: boolean;
  videosOk: boolean;
  musicOk: boolean;
  musicEditOk: boolean;
  itemRefOk: boolean;
}

/** Calculates the conditional offers for a real turn and for its cache warm-up. */
export async function budgetWithTurnToolGates(input: TurnToolGateInput): Promise<TurnToolGateResult> {
  const audience = { actor: input.actor, band: input.band, surface: input.surface, surfaceClass: input.surfaceClass, spoken: input.spoken };
  const answerImagesOk = safeGate(() => answerImagesAllowed({
    actor: input.actor,
    band: input.band,
    surfaceClass: input.surfaceClass,
    spoken: input.spoken,
    temporary: input.temporary,
    bare: input.bare,
    ephemeral: input.ephemeral,
  }));
  const pictureEligible = !input.bare && safeGate(() => picturesAllowed(audience));
  const videoEligible = !input.bare && safeGate(() => videosAllowed(audience));
  const musicEligible = !input.bare && safeGate(() => musicsAllowed(audience));
  const [picturesOk, videosOk, musicOk] = await Promise.all([
    pictureEligible ? readiness(pictureEngineReady) : false,
    videoEligible ? readiness(videoEngineReady) : false,
    musicEligible ? readiness(musicEngineReady) : false,
  ]);
  const musicEditOk = musicOk && safeGate(input.musicEditAvailable);
  const itemRefOk = !input.bare && input.actor.role !== "guest" && input.band !== "child" && input.surfaceClass === "written" && safeGate(() => itemRefsIn(input.text).length > 0);
  return {
    budget: withTurnToolGates(input.budget, answerImagesOk, picturesOk, videosOk, musicOk, musicEditOk, itemRefOk),
    answerImagesOk,
    picturesOk,
    videosOk,
    musicOk,
    musicEditOk,
    itemRefOk,
  };
}

function safeGate(gate: () => boolean): boolean {
  try {
    return gate();
  } catch {
    return false;
  }
}

async function readiness(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}
