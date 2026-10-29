import media from "@maipai/spec/vocab/companion-media.json";

export const imagingTargets = {
  portrait: {
    size: media.image.size,
    marginPercent: media.image.margin_percent,
    // The first bench records measured seconds beside each target.
    upscaleBelowShortSide: media.image.size,
  },
} as const;
