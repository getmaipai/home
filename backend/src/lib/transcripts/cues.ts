import type { Segment } from "./store";

export type Cue = {
  id: string;
  segment_id: string;
  start: number;
  end: number;
  text: string;
  text_overridden: boolean;
};
export type CueOptions = {
  maxCharsPerLine?: number;
  maxLines?: number;
  minDuration?: number;
  maxDuration?: number;
  readingSpeed?: number;
};

export function buildCues(segments: readonly Segment[], options: CueOptions = {}): Cue[] {
  const maxChars = options.maxCharsPerLine ?? 42;
  const maxLines = options.maxLines ?? 2;
  const minDuration = options.minDuration ?? 0.7;
  const maxDuration = options.maxDuration ?? 7;
  const readingSpeed = options.readingSpeed ?? 17;
  const capacity = maxChars * maxLines;
  const output: Cue[] = [];

  for (const segment of segments) {
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // A word longer than the configured capacity remains whole. Captioning must not invent a split inside it.
    const groups: string[][] = [];
    let group: string[] = [];
    for (const word of words) {
      const nextLength = group.join(" ").length + (group.length ? 1 : 0) + word.length;
      if (group.length && (nextLength > capacity || nextLength / readingSpeed > maxDuration)) {
        groups.push(group);
        group = [];
      }
      group.push(word);
    }
    if (group.length) groups.push(group);

    const span = Math.max(0, segment.end - segment.start);
    const weights = groups.map((part) => Math.max(minDuration, part.join(" ").length / readingSpeed));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const assignedSpan = Math.max(span, totalWeight);
    let elapsed = 0;
    groups.forEach((part, index) => {
      const start = segment.start + assignedSpan * (elapsed / totalWeight);
      elapsed += weights[index]!;
      const end = index === groups.length - 1
        ? segment.start + assignedSpan
        : segment.start + assignedSpan * (elapsed / totalWeight);
      output.push({
        id: `cue-${segment.id}-${index + 1}`,
        segment_id: segment.id,
        start,
        end: Math.max(start + Math.min(minDuration, assignedSpan), end),
        text: part.join(" "),
        text_overridden: false,
      });
    });
  }
  return output;
}
