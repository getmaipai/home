export type BeatCutPlan = { ok: true; segments: Array<{ clipIndex: number; inS: number; outS: number; length: number }>; videoSeconds: number; beatsPerCut: number } | { ok: false; line: string };

/** Pure beat-grid planner. Times in beats and downbeats are seconds from the song start. */
export function planBeatCut(input: { beats: number[]; downbeats: number[]; beatsPerCut: 1 | 2 | 4 | 8; lengthS: number; clipSeconds: Array<number | null> }): BeatCutPlan {
  const { beats, downbeats, clipSeconds } = input;
  if (beats.length < 4) return { ok: false, line: "I couldn't find a steady beat in that song. Try a song with a clearer rhythm." };
  let step: 1 | 2 | 4 | 8 = input.beatsPerCut;
  const build = (stride: number) => {
    const first = downbeats[0] ?? beats[0]!;
    const startIndex = beats.findIndex((beat) => beat >= first);
    if (startIndex < 0) return [] as number[];
    const cuts = [first];
    for (let i = startIndex + stride; i < beats.length; i += stride) {
      if (beats[i]! > input.lengthS) break;
      cuts.push(beats[i]!);
    }
    return cuts;
  };
  let cuts = build(step);
  while (cuts.length > 16 && step < 8) { step = (step * 2) as 1 | 2 | 4 | 8; cuts = build(step); }
  let effectiveLength = input.lengthS;
  while (cuts.length > 16) { effectiveLength = cuts[14] ?? cuts.at(-1)!; cuts = cuts.filter((cut) => cut <= effectiveLength); }
  const out: Array<{ clipIndex: number; inS: number; outS: number; length: number }> = [];
  const cursors = clipSeconds.map(() => 0);
  let prior = 0;
  for (const end of cuts) {
    const length = end - prior;
    const clipIndex = out.length % clipSeconds.length;
    const known = clipSeconds[clipIndex] ?? null;
    if (known !== null && length > known) return { ok: false, line: `One of those videos is shorter than a cut every ${step} beats. Use a longer video or cut on fewer beats.` };
    if (known !== null && cursors[clipIndex]! + length > known) cursors[clipIndex] = 0;
    const inS = cursors[clipIndex]!;
    const outS = inS + length;
    out.push({ clipIndex, inS: round(inS), outS: round(outS), length: round(length) });
    cursors[clipIndex] = outS;
    prior = end;
  }
  return { ok: true, segments: out, videoSeconds: round(prior), beatsPerCut: step };
}
const round = (n: number) => Math.round(n * 1000) / 1000;
