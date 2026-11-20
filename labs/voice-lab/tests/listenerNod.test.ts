import { expect, test } from "bun:test";
import { shouldNod, NOD } from "../src/listenerNod";

const base = { enabled: true, turnSpeechMs: 9000, silenceMs: 500, turnProbability: 0.1, sinceLastNodMs: 20000, nodsThisTurn: 0, roll: 0 };
test("a nod happens only at a real pause in a long turn, rarely, and never when off", () => {
  expect(shouldNod(base)).toBe(true);
  expect(shouldNod({ ...base, enabled: false })).toBe(false);
  expect(shouldNod({ ...base, turnSpeechMs: NOD.minTurnMs - 1 })).toBe(false);            // never during short turns
  expect(shouldNod({ ...base, silenceMs: 200 })).toBe(false);                           // not a pause yet
  expect(shouldNod({ ...base, silenceMs: 1200 })).toBe(false);                          // turn is over
  expect(shouldNod({ ...base, turnProbability: 0.9 })).toBe(false);                     // the turn model says they are done
  expect(shouldNod({ ...base, sinceLastNodMs: 3000 })).toBe(false);                     // spacing
  expect(shouldNod({ ...base, nodsThisTurn: 2 })).toBe(false);                          // at most two per turn
  expect(shouldNod({ ...base, roll: 0.9 })).toBe(false);                                // chance
});
