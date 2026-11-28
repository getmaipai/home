export type PodcastSkipState = "not_processed" | "queued" | "processing" | "ready" | "nothing_found" | "offline" | "unavailable";
export type PodcastMode = "skip" | "mark" | "off";
export function podcastStatusLabel(state: PodcastSkipState, skipped: number, mode: PodcastMode): string {
  if (state === "queued" || state === "processing") return "Processing";
  if (state === "offline" || state === "unavailable") return "Stack offline";
  if (state === "not_processed") return "Needs review";
  if (state === "nothing_found") return "No ads found";
  if (mode === "off") return "Skipping off";
  if (mode === "mark") return "Ready";
  return skipped > 0 ? `${skipped} breaks skipped` : "No ads found";
}
