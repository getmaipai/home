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
  conversationId?: string;
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

interface LatchedToolGates {
  pictureEngineReady: boolean;
  videoEngineReady: boolean;
  musicEngineReady: boolean;
  musicEditOk: boolean;
  itemRefOk: boolean;
}

const MAX_LATCHED_CONVERSATIONS = 500;
const conversationToolGateLatches = new Map<string, LatchedToolGates>();

export function __resetToolGateLatchForTests(): void {
  conversationToolGateLatches.clear();
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
  const [pictureReadyNow, videoReadyNow, musicReadyNow] = await Promise.all([
    pictureEligible ? readiness(pictureEngineReady) : false,
    videoEligible ? readiness(videoEngineReady) : false,
    musicEligible ? readiness(musicEngineReady) : false,
  ]);
  const latchKey = input.conversationId ? `${input.actor.id}\u0000${input.conversationId}` : undefined;
  const latch = latchKey ? getConversationLatch(latchKey) : null;
  const picturesOk = pictureEligible && (pictureReadyNow || latch?.pictureEngineReady === true);
  const videosOk = videoEligible && (videoReadyNow || latch?.videoEngineReady === true);
  const musicOk = musicEligible && (musicReadyNow || latch?.musicEngineReady === true);
  if (latch) {
    latch.pictureEngineReady ||= pictureEligible && pictureReadyNow;
    latch.videoEngineReady ||= videoEligible && videoReadyNow;
    latch.musicEngineReady ||= musicEligible && musicReadyNow;
  }

  const musicEditPermission = musicOk && musicEligible;
  const musicEditAvailable = musicEditPermission && safeGate(input.musicEditAvailable);
  if (latch && musicEditAvailable) latch.musicEditOk = true;
  const musicEditOk = musicEditPermission && (musicEditAvailable || latch?.musicEditOk === true);

  const itemRefPermission = !input.bare && input.actor.role !== "guest" && input.band !== "child" && input.surfaceClass === "written";
  const itemRefInMessage = itemRefPermission && safeGate(() => itemRefsIn(input.text).length > 0);
  if (latch && itemRefInMessage) latch.itemRefOk = true;
  const itemRefOk = itemRefPermission && (itemRefInMessage || latch?.itemRefOk === true);
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

function getConversationLatch(conversationId: string): LatchedToolGates {
  let latch = conversationToolGateLatches.get(conversationId);
  if (latch) {
    // Keep recently used conversations resident when the bounded map is full.
    conversationToolGateLatches.delete(conversationId);
    conversationToolGateLatches.set(conversationId, latch);
    return latch;
  }
  latch = { pictureEngineReady: false, videoEngineReady: false, musicEngineReady: false, musicEditOk: false, itemRefOk: false };
  conversationToolGateLatches.set(conversationId, latch);
  if (conversationToolGateLatches.size > MAX_LATCHED_CONVERSATIONS) {
    const oldest = conversationToolGateLatches.keys().next().value;
    if (oldest !== undefined) conversationToolGateLatches.delete(oldest);
  }
  return latch;
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
