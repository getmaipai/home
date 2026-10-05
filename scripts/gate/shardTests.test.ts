import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { balance, chooseShardCount, discoverTests, failedTests, junitFileSeconds, parseSummary, run } from "./shardTests";

describe("balance", () => {
  test("every file lands in exactly one shard", () => {
    const files = Array.from({ length: 23 }, (_, i) => `t${i}.test.ts`);
    const shards = balance(files, {}, 4);
    expect(shards.flat().sort()).toEqual([...files].sort());
  });

  test("a heavy file gets a shard to itself while light files share the rest", () => {
    const timings = { "big.test.ts": 100, "a.test.ts": 1, "b.test.ts": 1, "c.test.ts": 1 };
    const shards = balance(Object.keys(timings), timings, 2);
    expect(shards.find((s) => s.includes("big.test.ts"))).toEqual(["big.test.ts"]);
  });

  test("a file with no recorded time counts as the median, not zero", () => {
    const shards = balance(["new.test.ts", "a.test.ts", "b.test.ts"], { "a.test.ts": 5, "b.test.ts": 5 }, 3);
    expect(shards.length).toBe(3);
  });
});

describe("order inside a shard", () => {
  test("a file with no recorded time runs first so a new red test fails fast", () => {
    const [shard] = balance(["old.test.ts", "new.test.ts"], { "old.test.ts": 9 }, 1);
    expect(shard?.[0]).toBe("new.test.ts");
  });
});

describe("chooseShardCount", () => {
  test("MAIPAI_GATE_SHARDS wins, but never exceeds the file count", () => {
    expect(chooseShardCount({ env: "6", cores: 14, freeGb: 20, files: 100 })).toBe(6);
    expect(chooseShardCount({ env: "6", cores: 14, freeGb: 20, files: 2 })).toBe(2);
  });

  test("memory caps the count on a small machine", () => {
    expect(chooseShardCount({ cores: 14, freeGb: 1.7, files: 100 })).toBe(2);
  });

  test("cores cap it at half, and it is never below 1", () => {
    expect(chooseShardCount({ cores: 8, freeGb: 64, files: 100 })).toBe(4);
    expect(chooseShardCount({ cores: 1, freeGb: 0.1, files: 100 })).toBe(1);
  });
});

describe("parsing", () => {
  test("parseSummary reads bun's closing lines", () => {
    const out = " 12 pass\n 1 fail\n 30 expect() calls\nRan 13 tests across 3 files. [1.2s]\n";
    expect(parseSummary(out)).toEqual({ pass: 12, fail: 1, tests: 13, files: 3 });
  });

  test("parseSummary uses the final footer after a nested bun summary", () => {
    const out = "Ran 2 tests across 1 files. [0.1s]\n 76 pass\n 0 fail\nRan 76 tests across 8 files. [4.2s]\n";
    expect(parseSummary(out).files).toBe(8);
  });

  test("failedTests names each red test", () => {
    expect(failedTests("(pass) a\n(fail) b > c [3ms]\n")).toEqual(["(fail) b > c [3ms]"]);
  });

  test("junitFileSeconds sums testcase times per file", () => {
    const xml = `<testcase name="a" classname="x" time="0.5" file="tests/a.test.ts" line="1" />
<testcase name="b" classname="x" time="1.25" file="tests/a.test.ts" line="2" />
<testcase name="c" classname="x" time="2" file="tests/b.test.ts" line="2" />`;
    expect(junitFileSeconds(xml)).toEqual({ "tests/a.test.ts": 1.75, "tests/b.test.ts": 2 });
  });
});

describe("run: the gate's pass/fail meaning", () => {
  function fixture(body: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "maipai-shard-fixture-"));
    mkdirSync(join(dir, "tests"));
    for (const [name, src] of Object.entries(body)) writeFileSync(join(dir, "tests", name), src);
    return dir;
  }

  test("discoverTests finds test files under the root only", () => {
    const dir = fixture({ "a.test.ts": "", "helper.ts": "" });
    try {
      expect(discoverTests(dir, "tests")).toEqual(["tests/a.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("all green returns 0", async () => {
    const dir = fixture({
      "a.test.ts": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
      "b.test.ts": `import {test,expect} from "bun:test"; test("b",()=>expect(2).toBe(2));`,
    });
    try {
      expect(await run({ dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json") })).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("one failing test in any shard returns non-zero", async () => {
    const dir = fixture({
      "a.test.ts": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
      "b.test.ts": `import {test,expect} from "bun:test"; test("deliberately red",()=>expect(1).toBe(2));`,
    });
    try {
      expect(await run({ dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json") })).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
