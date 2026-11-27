export const PODCAST_SEGMENT_KINDS = ["ad", "sponsor", "bumper", "selfpromo", "intro", "outro", "recap"] as const;
export type PodcastSegmentKind = typeof PODCAST_SEGMENT_KINDS[number];
export type SegmentPolicy = "skip" | "mark" | "off" | "inherit";
export const PODCAST_SEGMENT_PIPELINE_VERSION = "1";
export const BUILTIN_SEGMENT_POLICY: Record<PodcastSegmentKind, Exclude<SegmentPolicy, "inherit">> = {
  ad: "skip", sponsor: "skip", bumper: "skip", selfpromo: "off", intro: "mark", outro: "mark", recap: "mark",
};
export function resolveSegmentPolicy(kind: PodcastSegmentKind, layers: { show?: SegmentPolicy; person?: SegmentPolicy; household?: SegmentPolicy }): Exclude<SegmentPolicy, "inherit"> {
  for (const value of [layers.show, layers.person, layers.household, BUILTIN_SEGMENT_POLICY[kind]]) if (value && value !== "inherit") return value;
  return BUILTIN_SEGMENT_POLICY[kind];
}
