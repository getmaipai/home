// TIER-HOME-04: the saved slot of a video level (`engines.video.tier.<tier>`) turned into the Stack request. The slot is read once, by `slotRun`
// (lib/tiers.ts); this file only maps its model and options onto the fields the Stack's video route takes. It runs when the job is sent, so a
// changed pick applies to the next job at that level, and a level switched off since the job was queued is sent at Standard.
// Options the video engine reads: `length_seconds` (seconds) and `resolution` (the size, never above the engine's own). `steps` and `sound` are
// not read by it (a distilled model with fixed steps; sound comes with the Detailed model): `SLOT_OPTIONS_READ` in shared/tierSlotOptions.ts.
import type { Lane } from "@/lib/pictures/lane";
import { videoModelForLane } from "@/lib/pictures/lane";
import type { AgeBand } from "@/lib/ageBand";
import { slotRun, type Tier } from "@/lib/tiers";
import { LTX25_DEFAULTS, LTX25_MAX_MODEL, LTX25_MODEL, ltx25Profile, videoSizeFor, QUICK_MAX_SECONDS, VIDEO_SIZES_BY_QUALITY, maxSecondsFor, type VideoQuality } from "@/lib/videos/quality";
import type { StackVideoStatus, VideoBody } from "@/lib/videos/stack";

type Body = Omit<VideoBody, "timeout_ms">;

/** The quality a slot's model id names: the LTX pin is Detailed, the Wan pin is Quick; any other id names neither. */
export function qualityOfSlotModel(id: string | null | undefined): VideoQuality | null {
  if (!id) return null;
  // LTX-2.5 serves both Standard and Boost (VIDEO-TIERS-01): its level is the job's tier, not its id (see `videoBodyForSlot`).
  if (id === "detailed" || id.startsWith("ltx")) return "detailed";
  if (id === "quick" || id.startsWith("fastwan") || id.startsWith("wan")) return "quick";
  return null;
}

const STEP = 64;
const shapeOf = (size: string | undefined): "default-landscape" | "default-portrait" | "other" => {
  if (size === undefined) return "default-landscape";
  const known = [...Object.values(VIDEO_SIZES_BY_QUALITY), ...Object.values(LTX25_DEFAULTS)];
  for (const sizes of known) { if (size === sizes.landscape) return "default-landscape"; if (size === sizes.portrait) return "default-portrait"; }
  // The Stack's own true LTX-2.5 sizes (a Boost profile of 640x320 is also a default shape).
  if (size === "640x320") return "default-landscape";
  if (size === "320x640") return "default-portrait";
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
export function videoBodyForSlot(base: Body, requested: Tier, band: AgeBand, lane: Lane, engine: Pick<StackVideoStatus, "qualities"> | null = null): { body: Body; tier: Tier; quality: VideoQuality } {
  const run = slotRun("video", requested, band);
  const body: Body = { ...base };
  delete body.tier;
  // VIDEO-TIERS-01: an adult's LTX-2.5 clip keeps its model at whatever level the slot lowers it to; its size and ceiling follow that level. A
  // slot an admin pointed at another model overrides it below, as before. A minor is never here (the lane check below puts it on Wan).
  const slotModel = run.lowered ? null : run.model;
  // LTX25-MAX-01: a Max clip keeps its model only while the job still runs at Max (an admin has not switched the Max slot off since it was queued) and
  // the person is an adult. Its size and ceiling are the Stack's `max` profile (a profile can only lower the ceiling). A job lowered to Boost goes
  // on as an LTX-2.5 Boost clip below; anything else is never sent the Max model.
  if (base.model === LTX25_MAX_MODEL) {
    const [bw, bh] = (base.size ?? "").split("x").map(Number);
    const portrait = !!bw && !!bh && bh > bw;
    if (lane === "adult" && run.tier === "max" && !run.lowered && (!slotModel || slotModel === LTX25_MAX_MODEL || slotModel.startsWith("ltx25"))) {
      body.size = videoSizeFor("ltx25max", "detailed", portrait, engine);
      if (body.seconds !== undefined) body.seconds = Math.max(1, Math.min(body.seconds, maxSecondsFor("detailed", "ltx25max", engine)));
      body.tier = "max";
      return { body, tier: "max", quality: "detailed" };
    }
    base = { ...base, model: LTX25_MODEL, size: portrait ? LTX25_DEFAULTS.standard.portrait : LTX25_DEFAULTS.standard.landscape };
    body.model = base.model;
    body.size = base.size;
  }
  if (base.model === LTX25_MODEL && lane === "adult" && (!slotModel || !qualityOfSlotModel(slotModel) || slotModel.startsWith("ltx25"))) {
    const level: VideoQuality = run.tier === "standard" ? "quick" : "detailed";
    const levelKey = level === "quick" ? "standard" : "boost";
    const portrait = shapeOf(base.size) === "default-portrait";
    // The queued size is the Stack's true size for the level it was queued at; a level lowered since (a switched-off Boost) gets the lower level's size.
    // The Stack's own reported profile for the level wins over the table, so a replayed job never sends a size the Stack lacks.
    const profile = ltx25Profile(engine, levelKey);
    const queuedSize = base.size ? base.size.split("x").map(Number) : [];
    const [qw, qh] = portrait ? [queuedSize[1], queuedSize[0]] : queuedSize;
    const listed = (engine?.qualities?.ltx25?.profiles ?? []).some((p) => p.name === levelKey && p.width === qw && p.height === qh);
    if (shapeOf(base.size) !== "other" && (run.lowered || (profile && !listed))) body.size = videoSizeFor("ltx25", level, portrait, engine);
    if (body.seconds !== undefined) body.seconds = Math.max(1, Math.min(body.seconds, maxSecondsFor(level, "ltx25", engine)));
    if (run.tier === "boost" || run.tier === "max") body.tier = run.tier;
    return { body, tier: run.tier, quality: level };
  }
  const shape = shapeOf(base.size);
  // Only an LTX-2.5 clip can end on a picture (the Stack answers 422 to it on Wan and Detailed): any other model sends the start picture alone.
  delete body.end_image;
  // A minor is never sent LTX-2.5 (rules 0, 8, 10): the model goes back to the lane's own and the size and ceiling follow Wan.
  if (base.model === LTX25_MODEL && lane !== "adult") body.model = videoModelForLane(lane, base.model);
  let quality: VideoQuality = body.model === LTX25_MODEL ? "detailed" : qualityOfSlotModel(body.model) ?? "quick";
  if (base.model === LTX25_MODEL && lane !== "adult") quality = "quick";
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
