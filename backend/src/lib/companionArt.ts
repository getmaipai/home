import { WAN_QUICK_VIDEO_MODEL, type Lane } from "@/lib/pictures/lane";
import { createHash } from "node:crypto";
import { pictureEngineStatus, __setPictureStatusForTests, __setPictureStatusReaderForTests } from "@/lib/pictures/ready";
import { pictureJobFor } from "@/lib/pictures/stack";
import { chooseVideoQuality, QUICK_BASE } from "@/lib/videos/quality";
import { videoEngineStatus, __setVideoStatusForTests, __setVideoStatusReaderForTests } from "@/lib/videos/ready";
import type { StackVideoStatus } from "@/lib/videos/stack";

export const COMPANION_STILL_MODEL_MISSING_LINE = "The chosen picture model is not installed or available. An admin can install it in Settings, AI and models.";
export const COMPANION_CLIP_MODEL_MISSING_LINE = "The chosen video model is not installed or available. An admin can add it in Settings, Models and storage.";
export const COMPANION_MODEL_MISMATCH_LINE = "The picture came out different from the one chosen. Try again.";

export interface CompanionArtChoice { model: string; quality: "quick" | "detailed"; }
/** A companion still or edit: the part the Stack says serves it (an opaque id Home records beside the picture), or null when the catalog could not say. Home sends no part with it; the Stack picks. */
export interface CompanionStillChoice { model: string | null; quality: "quick" | "detailed"; }
let statusReaders: { picture: typeof pictureEngineStatus; video: typeof videoEngineStatus } | null = null;
export function __setCompanionArtStatusReadersForTests(readers: typeof statusReaders): void {
  statusReaders = readers;
  if (readers) {
    __setPictureStatusReaderForTests(readers.picture);
    __setVideoStatusReaderForTests(readers.video);
  } else {
    __setPictureStatusReaderForTests(null);
    __setVideoStatusReaderForTests(null);
    __setPictureStatusForTests(undefined);
    __setVideoStatusForTests(undefined);
  }
}
export const promptHash = (prompt: string): string => createHash("sha256").update(prompt).digest("hex");

function refusal(line: string): never { throw Object.assign(new Error(line), { status: 503 }); }
/** What the jobs catalog says serves a companion's picture (the minor list: companion art is all-ages). A catalog that says no part is on refuses with the plain line; one that cannot be read leaves the part to the Stack. */
export function resolveCompanionStillFromCatalog(view: { available: boolean; part: { id: string } | null } | null): CompanionStillChoice {
  if (view && (!view.available || !view.part)) refusal(COMPANION_STILL_MODEL_MISSING_LINE);
  return { model: view?.part?.id ?? null, quality: "quick" };
}
export async function resolveCompanionStill(): Promise<CompanionStillChoice> { return resolveCompanionStillFromCatalog(await pictureJobFor("picture", "minor")); }
/** An edit names no part: the Stack picks, and the record keeps none until the Stack reports one. */
export function resolveCompanionEdit(): CompanionStillChoice { return { model: null, quality: "quick" }; }

/** Adult companions ask for sound; picture starts use Quick until LTX-2.5 reports picture support. `lane` is the lane of the person who will see the take (`laneOf`): only the adult lane gets the sound maker, any other lane the silent Quick one (AGE-ROUTING-REMOVE-01). */
export function resolveCompanionClipFromStatus(engine: StackVideoStatus | null, requested: "quick" | "detailed" = "quick", max = false, lane: Lane = "adult"): CompanionArtChoice {
  const choice = chooseVideoQuality({ engine, hasPicture: true, requested, adultLane: lane === "adult", ...(max ? { max: true } : {}) });
  if (!choice) refusal(COMPANION_CLIP_MODEL_MISSING_LINE);
  const model = choice.maker === "ltx25max" ? "ltx25-max" : choice.maker === "ltx25" ? "ltx25-q8" : engine?.qualities?.quick.id ?? engine?.model?.id ?? QUICK_BASE;
  const q = choice.maker === "ltx25max" ? engine?.qualities?.ltx25max : choice.maker === "ltx25" ? engine?.qualities?.ltx25 : engine?.qualities?.quick;
  if (engine?.qualities ? (!q || ("ready" in q && q.ready !== true) || !q.installed || !q.available) : choice.quality !== "quick" || !engine?.model?.installed || engine.model.id !== model) refusal(COMPANION_CLIP_MODEL_MISSING_LINE);
  return { model, quality: choice.quality };
}
/** The value the Stack's video `model` field takes (lib/pictures/lane.ts): LTX-2.5 q8 or the Quick model name. */
/** The names the Stack reports for the LTX-2.5 models, by the alias Home asks for them with (the model id its components list uses). */
export const LTX25_REPORTED_NAMES: Record<string, string> = { "ltx25-q8": "ltx-2-5-q8-distilled-mlx", "ltx25-max": "ltx-2-5-bf16-distilled-mlx-max" };
/** Whether the model a finished clip reports is the one that was asked for: its alias, its take's recorded model or the Stack's own name for it. */
export const reportedVideoModelMatches = (reported: string, art: CompanionArtChoice, takeModel: string): boolean =>
  reported === takeModel || reported === stackVideoModel(art) || reported === LTX25_REPORTED_NAMES[stackVideoModel(art)];
/** Whether the quality a finished clip reports is the one asked for: the Stack names the LTX-2.5 makers `ltx25` and `ltx25max`, Home's lanes are `quick` and `detailed`. */
export const reportedVideoQualityMatches = (reported: string, art: CompanionArtChoice): boolean =>
  reported === art.quality || (reported === "ltx25" && art.model === "ltx25-q8") || (reported === "ltx25max" && art.model === "ltx25-max");
export const stackVideoModel = (art: CompanionArtChoice): string => (art.model === "ltx25-q8" || art.model === "ltx25-max" ? art.model : WAN_QUICK_VIDEO_MODEL);
export async function resolveCompanionClip(requested: "quick" | "detailed" = "quick", max = false, lane: Lane = "adult"): Promise<CompanionArtChoice> { return resolveCompanionClipFromStatus(await (statusReaders?.video ?? videoEngineStatus)(), requested, max, lane); }
