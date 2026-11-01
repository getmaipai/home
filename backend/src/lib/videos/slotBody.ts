// TIER-HOME-04: the saved slot of a video level (`engines.video.tier.<tier>`) turned into the Stack request. The slot is read once, by `slotRun`
// (lib/tiers.ts); this file only maps its model and options onto the fields the Stack's video route takes. It runs when the job is sent, so a
// changed pick applies to the next job at that level, and a level switched off since the job was queued is sent at Standard.
// Options the video engine reads: `length_seconds` (seconds) and `resolution` (the size, never above the engine's own). `steps` and `sound` are
// not read by it (a distilled model with fixed steps; sound comes with the Detailed model): `SLOT_OPTIONS_READ` in shared/tierSlotOptions.ts.
import type { Lane } from "@/lib/pictures/lane";
import { videoModelForLane } from "@/lib/pictures/lane";
import type { AgeBand } from "@/lib/ageBand";
import { slotRun, type Tier } from "@/lib/tiers";
import { QUICK_MAX_SECONDS, VIDEO_SIZES_BY_QUALITY, maxSecondsFor, type VideoQuality } from "@/lib/videos/quality";
import type { VideoBody } from "@/lib/videos/stack";

type Body = Omit<VideoBody, "timeout_ms">;

/** The quality a slot's model id names: the LTX pin is Detailed, the Wan pin is Quick; any other id names neither. */
export function qualityOfSlotModel(id: string | null | undefined): VideoQuality | null {
  if (!id) return null;
  if (id === "detailed" || id.startsWith("ltx")) return "detailed";
  if (id === "quick" || id.startsWith("fastwan") || id.startsWith("wan")) return "quick";
  return null;
}

const STEP = 64;
const shapeOf = (size: string | undefined): "default-landscape" | "default-portrait" | "other" => {
  if (size === undefined) return "default-landscape";
  for (const sizes of Object.values(VIDEO_SIZES_BY_QUALITY)) { if (size === sizes.landscape) return "default-landscape"; if (size === sizes.portrait) return "default-portrait"; }
  return "other";
};
/** The size at `resolution` (the short side) in the maker's own shape; null when that is not smaller than the maker's default. */
function scaledSize(quality: VideoQuality, portrait: boolean, resolution: number): string | null {
  const [w, h] = VIDEO_SIZES_BY_QUALITY[quality].landscape.split("x").map(Number) as [number, number];
  if (resolution >= h) return null;
  const short = Math.max(256, Math.floor(resolution / STEP) * STEP);
  const long = Math.max(256, Math.floor((w * short) / h / STEP) * STEP);
  return portrait ? `${short}x${long}` : `${long}x${short}`;
}

/** The body to send for a job queued at `requested`: the slot's model, options and tier applied. */
export function videoBodyForSlot(base: Body, requested: Tier, band: AgeBand, lane: Lane): { body: Body; tier: Tier; quality: VideoQuality } {
  const run = slotRun("video", requested, band);
  const body: Body = { ...base };
  delete body.tier;
  const shape = shapeOf(base.size);
  let quality: VideoQuality = qualityOfSlotModel(base.model) ?? "quick";
  if (run.lowered) {
    delete body.model;
    quality = "quick";
  } else if (run.model && qualityOfSlotModel(run.model)) {
    const model = videoModelForLane(lane, run.model);
    if (model) { body.model = model; quality = qualityOfSlotModel(model) ?? quality; }
  }
  const portrait = shape === "default-portrait";
  // A size the tool filled in from the default follows the maker that really runs; a size the person asked for stays.
  if (shape !== "other") body.size = VIDEO_SIZES_BY_QUALITY[quality][portrait ? "portrait" : "landscape"];
  const length = run.options.length_seconds;
  if (!run.lowered && typeof length === "number" && (base.seconds === undefined || base.seconds === QUICK_MAX_SECONDS)) body.seconds = Math.round(length);
  if (body.seconds !== undefined) body.seconds = Math.max(1, Math.min(body.seconds, maxSecondsFor(quality)));
  const resolution = run.options.resolution;
  if (!run.lowered && typeof resolution === "number" && shape !== "other") {
    const scaled = scaledSize(quality, portrait, resolution);
    if (scaled) body.size = scaled;
  }
  if (run.tier === "boost" || run.tier === "max") body.tier = run.tier;
  return { body, tier: run.tier, quality };
}
