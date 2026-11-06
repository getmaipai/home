import { WAN_QUICK_VIDEO_MODEL } from "@/lib/pictures/lane";
import { createHash } from "node:crypto";
import { chooseQuality, QUICK_MODEL, DETAILED_MODEL, ERNIE_MODEL } from "@/lib/pictures/quality";
import { pictureEngineStatus, __setPictureStatusForTests, __setPictureStatusReaderForTests } from "@/lib/pictures/ready";
import { chooseVideoQuality, QUICK_BASE } from "@/lib/videos/quality";
import { videoEngineStatus, __setVideoStatusForTests, __setVideoStatusReaderForTests } from "@/lib/videos/ready";
import type { StackImageStatus } from "@/lib/pictures/stack";
import type { StackVideoStatus } from "@/lib/videos/stack";

export const COMPANION_STILL_MODEL_MISSING_LINE = "The chosen picture model is not installed or available. An admin can install it in Settings, AI and models.";
export const COMPANION_CLIP_MODEL_MISSING_LINE = "The chosen video model is not installed or available. An admin can add it in Settings, Models and storage.";
export const COMPANION_MODEL_MISMATCH_LINE = "The picture came out different from the one chosen. Try again.";
export const COMPANION_EDIT_MODEL = QUICK_MODEL;

export interface CompanionArtChoice { model: string; quality: "quick" | "detailed"; }
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
function installedStill(engine: StackImageStatus | null, model: string): boolean {
  const record = engine?.models.find((item) => item.id === model);
  return Boolean(record?.installed && record.available !== false);
}
export function resolveCompanionStillFromStatus(engine: StackImageStatus | null): CompanionArtChoice {
  const choice = chooseQuality({ engine });
  if (choice.note === "detailed_not_installed" || choice.note === "detailed_off") refusal(COMPANION_STILL_MODEL_MISSING_LINE);
  const model = choice.model ?? QUICK_MODEL;
  if (!installedStill(engine, model) || ![QUICK_MODEL, ERNIE_MODEL, DETAILED_MODEL].includes(model)) refusal(COMPANION_STILL_MODEL_MISSING_LINE);
  return { model, quality: choice.quality };
}
export async function resolveCompanionStill(): Promise<CompanionArtChoice> { return resolveCompanionStillFromStatus(await (statusReaders?.picture ?? pictureEngineStatus)()); }
export function resolveCompanionEdit(): CompanionArtChoice { return { model: COMPANION_EDIT_MODEL, quality: "quick" }; }

/** Adult companions ask for sound; picture starts use Quick until LTX-2.5 reports picture support. */
export function resolveCompanionClipFromStatus(engine: StackVideoStatus | null, requested: "quick" | "detailed" = "quick"): CompanionArtChoice {
  const choice = chooseVideoQuality({ engine, hasPicture: true, requested, adultLane: true });
  const model = choice.maker === "ltx25max" ? "ltx25-max" : choice.maker === "ltx25" ? "ltx25-q8" : engine?.qualities?.quick.id ?? engine?.model?.id ?? QUICK_BASE;
  const q = choice.maker === "ltx25max" ? engine?.qualities?.ltx25max : choice.maker === "ltx25" ? engine?.qualities?.ltx25 : engine?.qualities?.quick;
  if (engine?.qualities ? (!q || ("ready" in q && q.ready !== true) || !q.installed || !q.available) : choice.quality !== "quick" || !engine?.model?.installed || engine.model.id !== model) refusal(COMPANION_CLIP_MODEL_MISSING_LINE);
  return { model, quality: choice.quality };
}
/** The value the Stack's video `model` field takes (lib/pictures/lane.ts): LTX-2.5 q8 or the Quick model name. */
export const stackVideoModel = (art: CompanionArtChoice): string => (art.model === "ltx25-q8" || art.model === "ltx25-max" ? art.model : WAN_QUICK_VIDEO_MODEL);
export async function resolveCompanionClip(requested: "quick" | "detailed" = "quick"): Promise<CompanionArtChoice> { return resolveCompanionClipFromStatus(await (statusReaders?.video ?? videoEngineStatus)(), requested); }
