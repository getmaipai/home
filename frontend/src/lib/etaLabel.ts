// GENPREVIEW-01: how long is left on a picture or video, in the words a person reads. The engine counts whole
// seconds from earlier runs of the same size; this rounds them to what is worth saying ("about 1 minute left").
export function etaLabel(seconds: number | null | undefined, options: { short?: boolean } = {}): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return undefined;
  if (seconds < 5) return "almost done";
  // The picture card's caption is one line next to the step and the clock, so it gets the short form.
  if (options.short) return seconds < 45 ? `${Math.round(seconds / 5) * 5}s left` : `${Math.max(1, Math.round(seconds / 60))} min left`;
  if (seconds < 45) return `about ${Math.round(seconds / 5) * 5} seconds left`;
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return "about 1 minute left";
  return `about ${minutes} minutes left`;
}
