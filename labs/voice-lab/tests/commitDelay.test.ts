import { commitDelay as cd, SENTENCE_END_COMMIT_MS } from "../src/commitDelay";
test("a finished sentence waits only a short beat even when the turn model is unsure (the three timeout turns of the measure run)", () => {
  expect(cd("Why do cats purr?", 0.023, 900)).toBe(SENTENCE_END_COMMIT_MS);
  expect(cd("What can I do on a sunny afternoon with the kids?", 0.099, 900)).toBe(SENTENCE_END_COMMIT_MS);
  expect(cd("I feel a little tired today. Any advice?", 0.578, 900)).toBe(SENTENCE_END_COMMIT_MS);
});
test("unfinished or very short speech keeps the long wait (misfire cases)", () => {
  expect(cd("So I was thinking, and", 0.9, 900)).toBeGreaterThanOrEqual(900);
  expect(cd("Well,", 0.1, 900)).toBeGreaterThanOrEqual(900);
  expect(cd("Okay.", 0.1, 900)).toBeGreaterThanOrEqual(900);       // two words or fewer: could be the start of more
  expect(cd("I want to tell you about", 0.1, 900)).toBeGreaterThanOrEqual(900);
});
