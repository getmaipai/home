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
import { laneOf } from "@/lib/pictures/lane";
import { itemRefsIn } from "@/lib/items/tool";
import { writingFormatsFor } from "@/lib/writingFormats";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { withTurnToolGates, type MusicObjectGate } from "./budget";
import { isMusicObjectRef, musicObjectOf, type MusicObjectRef } from "@/lib/music/objects";
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
  /** VIDEO-CHAT-01: whether the chat already holds a finished video (left out: no). */
  videoEditAvailable?: () => boolean;
  /** MUSIC-STUDIO-EDIT: the newest band, album or song style card in the chat (left out: none). */
  musicObjectInThread?: () => MusicObjectRef | null;
}

interface LatchedToolGates {
  pictureEngineReady: boolean;
  videoEngineReady: boolean;
  musicEngineReady: boolean;
  musicEditOk: boolean;
  videoEditOk: boolean;
  itemRefOk: boolean;
  musicBandOk: boolean;
  musicObject: MusicObjectRef | null;
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
  videoEditOk: boolean;
  itemRefOk: boolean;
  musicBandOk: boolean;
  /** The made-music object this turn follows: a gate value for the offers, and the object itself when one is named. */
  musicObject: MusicObjectGate;
  musicObjectRef: MusicObjectRef | null;
  /** WRITING-FORMATS-03: a written, non-bare turn and at least one installed format the person's role may use. */
  writingFormatOk: boolean;
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
    videoEligible ? readiness(() => videoEngineReady(laneOf(audience) === "adult")) : false,
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

  // Adults only: a teen or child can make a clip but never edit one (makeVideoFor refuses them), so the tool is not offered to them.
  const videoEditPermission = videosOk && videoEligible && input.band === "adult";
  const videoEditAvailable = videoEditPermission && safeGate(input.videoEditAvailable ?? (() => false));
  if (latch && videoEditAvailable) latch.videoEditOk = true;
  const videoEditOk = videoEditPermission && (videoEditAvailable || latch?.videoEditOk === true);

  const itemRefPermission = !input.bare && input.actor.role !== "guest" && input.band !== "child" && input.surfaceClass === "written";
  // MUSIC-LIKE-01: a song reference (maipai://music/track/...) offers `make_band` and nothing else; every other reference offers
  // `read_item`. The two never share a turn, so the sixteen-tool worst case holds (a message with both kinds offers read_item only).
  const refsInMessage = itemRefPermission ? (() => { try { return itemRefsIn(input.text); } catch { return []; } })() : [];
  // MUSIC-STUDIO-EDIT: a reference to a made band, album or song style is a music object like a song. The newest object wins: the
  // message's own reference, then the newest card in the thread, then what the chat followed before. One object, one set of tools.
  const objectRefs = refsInMessage.filter(isMusicObjectRef);
  const otherRefInMessage = refsInMessage.some((ref) => !isMusicObjectRef(ref));
  const refObject = otherRefInMessage ? null : (() => { const picked = objectRefs.find((ref) => ref.kind !== "track") ?? objectRefs[0]; return picked ? musicObjectOf(picked) : null; })();
  if (latch && otherRefInMessage) latch.itemRefOk = true;
  const itemRefOk = itemRefPermission && (otherRefInMessage || latch?.itemRefOk === true);
  const objectAllowed = itemRefPermission && musicOk && !itemRefOk;
  const threadObject = objectAllowed && !refObject ? (() => { try { return input.musicObjectInThread?.() ?? null; } catch { return null; } })() : null;
  const musicObjectRef = objectAllowed ? (refObject ?? threadObject ?? latch?.musicObject ?? null) : null;
  if (latch && objectAllowed && musicObjectRef) { latch.musicObject = musicObjectRef; if (musicObjectRef.kind === "track") latch.musicBandOk = true; }
  const musicBandOk = objectAllowed && musicObjectRef?.kind === "track";
  const musicObject: MusicObjectGate = !objectAllowed ? null : (musicObjectRef?.kind ?? "none");
  const writingFormatOk = !input.bare && input.surfaceClass === "written" && safeGate(() => writingFormatsFor(input.actor.role).length > 0);
  return {
    budget: withTurnToolGates(input.budget, answerImagesOk, picturesOk, videosOk, musicOk, musicEditOk, itemRefOk, musicBandOk, videoEditOk, musicObject, writingFormatOk),
    writingFormatOk,
    answerImagesOk,
    picturesOk,
    videosOk,
    musicOk,
    musicEditOk,
    videoEditOk,
    itemRefOk,
    musicBandOk,
    musicObject,
    musicObjectRef,
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
  latch = { pictureEngineReady: false, videoEngineReady: false, musicEngineReady: false, musicEditOk: false, videoEditOk: false, itemRefOk: false, musicBandOk: false, musicObject: null };
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
