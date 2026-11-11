import media from "@maipai/spec/vocab/companion-media.json";
import { makerOfModel, videoSizeFor, type VideoQuality } from "@/lib/videos/quality";
import type { StackVideoStatus } from "@/lib/videos/stack";

/**
 * The size a take is asked for: the video flow's own size picker (`videoSizeFor`, which reads the Stack's profiles and knows the
 * models' measured sizes and their tall twins), by the model that makes it and the shape of the picture. Any picture can start a take:
 * the caller fits it to this size (the whole picture kept, key colour around it). The older maker (Wan Quick) keeps the spec's `generate` square.
 */
export function takeClipSize(model: string, quality: VideoQuality, portrait: boolean, engine?: StackVideoStatus | null): { width: number; height: number } {
  const maker = makerOfModel(model, quality);
  if (maker === "wan") return { width: media.generate.width, height: media.generate.height };
  const [width, height] = videoSizeFor(maker, quality, portrait, engine ?? null).split("x").map(Number);
  return { width: width!, height: height! };
}
