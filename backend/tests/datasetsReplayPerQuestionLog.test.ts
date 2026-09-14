// replay-per-question.ts's own pure text transforms (no subprocess, no
// engine): stripping every run header but the first, and attaching a
// question's own measured RSS to its own [replay-question] row.
import { describe, expect, test } from "bun:test";
import { stripHeaderBlock, attachRss, parseFreeMemoryMb } from "../scripts/bench/datasets/replayPerQuestionLog";

const HEADER = '## Run header\n\n```json\n{\n  "commit": "abc123",\n  "date": "2026-09-14T00:00:00.000Z"\n}\n```\n\n';

describe("stripHeaderBlock", () => {
  test("removes the header block, leaving the rest of the text untouched", () => {
    const body = "[memory.judge] processed=1\n[replay-question] {\"questionId\":\"q1\"}\n";
    expect(stripHeaderBlock(HEADER + body)).toBe(body);
  });

  test("text with no header block passes through unchanged", () => {
    const body = "[memory.judge] processed=1\n";
    expect(stripHeaderBlock(body)).toBe(body);
  });

  test("only the first header is stripped when called once - the caller decides per-invocation whether to call it, so two calls on the same already-stripped text are a no-op the second time", () => {
    const body = "[replay-question] {\"questionId\":\"q1\"}\n";
    const once = stripHeaderBlock(HEADER + body);
    expect(stripHeaderBlock(once)).toBe(once);
  });
});

describe("parseFreeMemoryMb", () => {
  // A real vm_stat sample (this machine, 2026-09-14) - page size and
  // the free-pages line are the only two fields this function reads.
  const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    72658.
Pages active:                                 384071.
Pages inactive:                               369414.
Pages speculative:                             13526.
Pages throttled:                                   0.
Pages wired down:                             226940.
Pages purgeable:                                5179.
`;

  test("free pages times the page size vm_stat itself reports, in MB", () => {
    // 72658 * 16384 bytes = 1,190,412,288 bytes = ~1135.3 MB.
    expect(parseFreeMemoryMb(VM_STAT)).toBeCloseTo(1135.3, 1);
  });

  test("text with no recognizable vm_stat shape returns null, never throws or returns 0", () => {
    expect(parseFreeMemoryMb("not vm_stat output at all")).toBeNull();
  });

  test("a page size line but no free-pages line still returns null - both fields are required", () => {
    expect(parseFreeMemoryMb("Mach Virtual Memory Statistics: (page size of 16384 bytes)\n")).toBeNull();
  });
});

describe("attachRss", () => {
  test("adds processStartRssKb and processEndRssKb onto the one [replay-question] JSON line", () => {
    const text = '[route] {"turn_id":"t1"}\n[replay-question] {"questionId":"q1","verdict":"correct"}\n';
    const result = attachRss(text, 12345, 67890);
    expect(result).toContain('[replay-question] {"questionId":"q1","verdict":"correct","processStartRssKb":12345,"processEndRssKb":67890}');
    // Every other line is untouched.
    expect(result).toContain('[route] {"turn_id":"t1"}');
  });

  test("null RSS readings (ps failed to sample, or the process died too fast) are recorded as null, never dropped or coerced to 0", () => {
    const text = '[replay-question] {"questionId":"q1"}\n';
    const result = attachRss(text, null, null);
    expect(result).toContain('"processStartRssKb":null,"processEndRssKb":null');
  });

  test("text with no [replay-question] line (the subprocess threw before ever reaching one) passes through unchanged", () => {
    const text = "[replay] question q1 threw, scored incorrect: some error\n";
    expect(attachRss(text, 100, 200)).toBe(text);
  });

  test("existing fields on the row survive alongside the new RSS ones - a full realistic row", () => {
    const text = '[replay-question] {"questionId":"q1","type":"temporal-reasoning","verdict":"correct","reply":"hi","recallHits":[{"turnId":"t1","foundInContext":true}]}\n';
    const result = attachRss(text, 1, 2);
    const line = result.split("\n").find((l) => l.startsWith("[replay-question]"))!;
    const json = JSON.parse(line.slice("[replay-question] ".length)) as Record<string, unknown>;
    expect(json).toMatchObject({ questionId: "q1", type: "temporal-reasoning", verdict: "correct", processStartRssKb: 1, processEndRssKb: 2 });
    expect(json.recallHits).toEqual([{ turnId: "t1", foundInContext: true }]);
  });
});
