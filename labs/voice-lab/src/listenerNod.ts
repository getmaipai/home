// A rare, quiet "mm-hm" while the person is in a long turn, at a natural pause, without taking the turn. Pure decision, no sound here.
export type NodInput = { enabled: boolean; turnSpeechMs: number; silenceMs: number; turnProbability: number; sinceLastNodMs: number; nodsThisTurn: number; roll: number };
export const NOD = { minTurnMs: 6000, minPauseMs: 380, maxPauseMs: 900, minGapMs: 10_000, maxPerTurn: 2, chance: 0.5, maxTurnProbability: 0.45 };
export function shouldNod(i: NodInput): boolean {
  if (!i.enabled) return false;
  if (i.turnSpeechMs < NOD.minTurnMs) return false;                       // never during short turns
  if (i.silenceMs < NOD.minPauseMs || i.silenceMs > NOD.maxPauseMs) return false; // a real pause, but not so long that the turn is over
  if (i.turnProbability >= 0 && i.turnProbability > NOD.maxTurnProbability) return false; // the turn model thinks they are done: answer instead
  if (i.sinceLastNodMs < NOD.minGapMs || i.nodsThisTurn >= NOD.maxPerTurn) return false;
  return i.roll < NOD.chance;
}
