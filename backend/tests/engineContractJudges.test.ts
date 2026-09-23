import { describe, expect, test } from "bun:test";
import { cacheState, judgeAbort, judgeAutoNegative, judgeReasoningSeparated, judgeRequired, judgeTiming } from "../scripts/bench/engine-contract";

describe("judgeRequired", () => {
  test("a required reply with a websearch call passes", () => {
    const reply = {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                type: "function",
                function: { name: "websearch", arguments: JSON.stringify({ expression: "president of chile" }) },
              },
            ],
          },
        },
      ],
    };
    const result = judgeRequired(reply);
    expect(result.pass).toBe(true);
  });

  test("a required reply with plain content fails with a reason naming tool_calls", () => {
    const reply = { choices: [{ message: { content: "The president of Chile is..." } }] };
    const result = judgeRequired(reply);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("tool_calls");
  });
});

describe("judgeAutoNegative", () => {
  test("an auto reply with content and no calls passes", () => {
    const reply = { choices: [{ message: { content: "Good morning! How can I help?" } }] };
    const result = judgeAutoNegative(reply);
    expect(result.pass).toBe(true);
  });

  test("an auto reply with a call fails", () => {
    const reply = {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ type: "function", function: { name: "websearch", arguments: JSON.stringify({ expression: "good morning" }) } }],
          },
        },
      ],
    };
    const result = judgeAutoNegative(reply);
    expect(result.pass).toBe(false);
  });
});

describe("judgeReasoningSeparated", () => {
  test("a reasoning reply with both fields passes", () => {
    const reply = { choices: [{ message: { reasoning_content: "12 plus 30 is 42.", content: "The answer is 42." } }] };
    const result = judgeReasoningSeparated(reply);
    expect(result.pass).toBe(true);
  });

  test("a reasoning reply with think tags in content fails", () => {
    const reply = { choices: [{ message: { reasoning_content: "12 plus 30 is 42.", content: "<think>12 plus 30 is 42.</think>The answer is 42." } }] };
    const result = judgeReasoningSeparated(reply);
    expect(result.pass).toBe(false);
  });
});

describe("judgeTiming", () => {
  test("timing passes on timings", () => {
    const reply = { timings: { prompt_ms: 120, predicted_ms: 340 }, choices: [{ message: { content: "ok" } }] };
    expect(judgeTiming(reply).pass).toBe(true);
  });

  test("timing passes on usage.completion_tokens alone", () => {
    const reply = { usage: { completion_tokens: 42 }, choices: [{ message: { content: "ok" } }] };
    expect(judgeTiming(reply).pass).toBe(true);
  });

  test("timing fails on neither", () => {
    const reply = { choices: [{ message: { content: "ok" } }] };
    const result = judgeTiming(reply);
    expect(result.pass).toBe(false);
  });
});

describe("judgeAbort", () => {
  test("abort passes at median+200", () => {
    const result = judgeAbort(1200, 1000);
    expect(result.pass).toBe(true);
  });

  test("abort fails at median+201", () => {
    const result = judgeAbort(1201, 1000);
    expect(result.pass).toBe(false);
  });
});

describe("cacheState", () => {
  test("cacheState reads usage.prompt_tokens_details.cached_tokens", () => {
    const reply = { usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } } };
    expect(cacheState(reply)).toEqual({ cached_tokens: 80, prompt_tokens: 100 });
  });

  test("cacheState returns 0 when absent", () => {
    expect(cacheState({ usage: { prompt_tokens: 100 } })).toEqual({ cached_tokens: 0, prompt_tokens: 100 });
    expect(cacheState({})).toEqual({ cached_tokens: 0, prompt_tokens: 0 });
  });
});
