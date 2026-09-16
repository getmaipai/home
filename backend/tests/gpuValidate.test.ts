import { describe, expect, test } from "bun:test";
import {
  promptForContext,
  throttleFindings,
  verdict,
} from "../scripts/bench/gpu-validate";
describe("GPU validation pure checks", () => {
  test("sizes a prompt to about ninety percent of context in tokens", () => {
    const tokensOf = (text: string) => Math.ceil(text.length / 5);
    const prompt = promptForContext(1000, tokensOf);
    const tokens = tokensOf(prompt);
    expect(tokens).toBeGreaterThanOrEqual(880);
    expect(tokens).toBeLessThanOrEqual(920);
  });
  test("finds sustained throttling below seventy percent", () => {
    expect(
      throttleFindings([
        { atSeconds: 30, tps: 100 },
        { atSeconds: 120, tps: 100 },
        { atSeconds: 150, tps: 69 },
      ]),
    ).toHaveLength(1);
    expect(
      throttleFindings([
        { atSeconds: 30, tps: 100 },
        { atSeconds: 150, tps: 70 },
      ]),
    ).toHaveLength(0);
  });
  test("verdict requires fill, minimum throughput and no throttle", () => {
    const row = [
      {
        concurrency: 1,
        streamTps: 20,
        aggregateTps: 20,
        firstTokenP50Ms: 1,
        firstTokenP95Ms: 2,
      },
    ];
    expect(verdict(true, row, [], 20)).toBe("pass");
    expect(verdict(false, row, [], 20)).toBe("fail");
    expect(verdict(true, row, [{ atSeconds: 150, tps: 1 }], 20)).toBe("fail");
  });
});
