import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { balance, chooseShardCount, discoverTests, failedTests, FlakeLedger, junitFileSeconds, parseStackBudget, parseSummary, readShardLog, reserveWorkerSlot, run, workerSlotCount } from "./shardTests";

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

describe("readShardLog", () => {
  test("a test's own stdout never hides bun's summary: stdout first, then the stderr report", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-shard-log-"));
    try {
      const log = join(dir, "s0.log");
      writeFileSync(`${log}.out`, "Ran 1 test across 1 file. [9.00ms]\n");
      writeFileSync(log, " 82 pass\n 0 fail\nRan 82 tests across 9 files. [2.41s]\n");
      expect(parseSummary(readShardLog(log))).toEqual({ pass: 82, fail: 0, tests: 82, files: 9 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chooseShardCount", () => {
  test("MAIPAI_GATE_SHARDS wins, but never exceeds the file count", () => {
    expect(chooseShardCount({ env: "6", cores: 14, freeGb: 20, files: 100 })).toBe(6);
    expect(chooseShardCount({ env: "6", cores: 14, freeGb: 20, files: 2 })).toBe(2);
  });

  test("engine and OS reserves cap forced workers to reclaimable memory", () => {
    expect(chooseShardCount({ env: "12", cores: 14, freeGb: 4.5, totalGb: 24, engineGb: 9, osReserveGb: 3, files: 100, gbPerShard: 1.5 })).toBe(3);
  });

  test("memory caps the count using the conservative worker peak", () => {
    expect(chooseShardCount({ cores: 14, freeGb: 1.7, files: 100, gbPerShard: 1.25 })).toBe(1);
  });

  test("cores cap it at half, and it is never below 1", () => {
    expect(chooseShardCount({ cores: 8, freeGb: 64, files: 100 })).toBe(4);
    expect(chooseShardCount({ cores: 1, freeGb: 0.1, files: 100 })).toBe(1);
  });
});

describe("Stack memory reserve", () => {
  test("adds measured resident peaks and falls back when any loaded role is unmeasured", () => {
    expect(parseStackBudget({ loaded: [{ peakBytes: 1024 ** 3, measured: true }, { peakBytes: 512 * 1024 ** 2, measured: true }] })).toBe(1.5);
    expect(parseStackBudget({ loaded: [{ peakBytes: 1024 ** 3, measured: false }] })).toBe(8);
    expect(parseStackBudget({ loaded: null })).toBe(8);
  });
});

describe("shared worker slots", () => {
  test("the runner-wide semaphore is atomic and refuses the first slot above budget", () => {
    const directory = mkdtempSync(join(tmpdir(), "maipai-worker-slots-"));
    try {
      const slots = Array.from({ length: 3 }, () => reserveWorkerSlot(directory, 3));
      expect(slots.every((slot) => typeof slot === "string")).toBe(true);
      expect(workerSlotCount(directory)).toBe(3);
      expect(reserveWorkerSlot(directory, 3)).toBeNull();
      rmSync(slots[0] as string, { force: true });
      expect(workerSlotCount(directory)).toBe(2);
      expect(reserveWorkerSlot(directory, 3)).not.toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
  const fixtureBudget = {
    engineGb: 0,
    gbPerShard: 1,
    resourceProbe: () => ({ reclaimableGb: 64, totalGb: 64, pressureLevel: 0 }),
    sleep: async () => {},
  };

  function fixture(body: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "maipai-shard-fixture-"));
    mkdirSync(join(dir, "tests"));
    for (const [name, src] of Object.entries(body)) writeFileSync(join(dir, "tests", name), src);
    return dir;
  }

  function ledger(dir: string, testName: string, file = "tests/a.test.ts"): FlakeLedger {
    const today = new Date().toISOString().slice(0, 10);
    const deadline = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    return { version: 2, flakes: [{ workspace: dir.split("/").at(-1)!, file, test: testName, owner: "codex-a", date_added: today, deadline, cause: "unknown", log: "/tmp/flake.log", issue: 1 }], serial: {}, skipped: [] };
  }

  async function quietRun(options: Parameters<typeof run>[0]): Promise<number> {
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    const log = console.log;
    const error = console.error;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    console.log = () => {};
    console.error = () => {};
    try { return await run({ ...fixtureBudget, ...options }); }
    finally { process.stdout.write = stdout; process.stderr.write = stderr; console.log = log; console.error = error; }
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
      expect(await run({ ...fixtureBudget, dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json") })).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pressure level 2 pauses every new shard until pressure falls", async () => {
    const marker = join(tmpdir(), `maipai-pressure-${Date.now()}`);
    const dir = fixture(Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`w${index}.test.ts`,
      `import {test} from "bun:test"; import {writeFileSync} from "node:fs"; test("worker ${index}",()=>writeFileSync(${JSON.stringify(`${marker}-${index}`)},"started"));`,
    ])));
    const levels = [0, 2, 2, 0, 0, 0];
    let pauses = 0;
    const previous = process.env.MAIPAI_GATE_SHARDS;
    delete process.env.MAIPAI_GATE_SHARDS;
    try {
      expect(await quietRun({
        dir,
        root: "tests",
        shards: 3,
        timingsPath: join(dir, "t.json"),
        engineGb: 0,
        gbPerShard: 1,
        resourceProbe: () => ({ reclaimableGb: 16, totalGb: 16, pressureLevel: levels.shift() ?? 0 }),
        sleep: async () => {
          pauses += 1;
          expect([0, 1, 2].every((index) => !existsSync(`${marker}-${index}`))).toBe(true);
        },
      })).toBe(0);
      expect(pauses).toBe(2);
      expect([0, 1, 2].every((index) => existsSync(`${marker}-${index}`))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MAIPAI_GATE_SHARDS;
      else process.env.MAIPAI_GATE_SHARDS = previous;
      rmSync(dir, { recursive: true, force: true });
      for (let index = 0; index < 3; index += 1) rmSync(`${marker}-${index}`, { force: true });
    }
  });

  test("concurrent workspace runners share one memory budget", async () => {
    const slotsDir = mkdtempSync(join(tmpdir(), "maipai-shared-workers-"));
    const first = fixture(Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`a${index}.test.ts`,
      `import {test} from "bun:test"; test("a${index}",async()=>Bun.sleep(150));`,
    ])));
    const second = fixture(Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`b${index}.test.ts`,
      `import {test} from "bun:test"; test("b${index}",async()=>Bun.sleep(150));`,
    ])));
    let maxSlotsSeen = 0;
    const resourceProbe = () => {
      const slots = readdirSync(slotsDir).filter((name) => name.startsWith("slot-")).length;
      maxSlotsSeen = Math.max(maxSlotsSeen, slots);
      return { reclaimableGb: 5, totalGb: 8, pressureLevel: 0 };
    };
    const options = (dir: string) => ({
      dir,
      root: "tests",
      shards: 4,
      timingsPath: join(dir, "timings.json"),
      engineGb: 0,
      gbPerShard: 2.5,
      resourceProbe,
      workerSlotsDir: slotsDir,
    });
    try {
      expect(await Promise.all([run(options(first)), run(options(second))])).toEqual([0, 0]);
      expect(maxSlotsSeen).toBe(2);
      expect(readdirSync(slotsDir).filter((name) => name.startsWith("slot-")).length).toBe(0);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    }
  });

  test("one failing test in any shard returns non-zero", async () => {
    const dir = fixture({
      "a.test.ts": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
      "b.test.ts": `import {test,expect} from "bun:test"; test("deliberately red",()=>expect(1).toBe(2));`,
    });
    try {
      expect(await quietRun({ dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json") })).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unlisted failure stops the other shards", async () => {
    const dir = fixture({ "a.test.ts": "", "b.test.ts": "" });
    const marker = join(dir, "sibling-finished");
    writeFileSync(join(dir, "tests/a.test.ts"), `import {test,expect} from "bun:test"; test("unlisted red",()=>expect(1).toBe(2));`);
    writeFileSync(join(dir, "tests/b.test.ts"), `import {test} from "bun:test"; import {writeFileSync} from "node:fs"; test("long sibling",async()=>{await Bun.sleep(1000);writeFileSync(${JSON.stringify(marker)},"done")});`);
    try {
      expect(await quietRun({ dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json"), changedFiles: [] })).not.toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a listed failure lets all shards finish, reruns that test once, and records FLAKY", async () => {
    const dir = fixture({ "a.test.ts": "", "b.test.ts": "" });
    const marker = join(dir, "first-run");
    const other = join(dir, "other-ran");
    const aPath = join(dir, "tests/a.test.ts");
    const bPath = join(dir, "tests/b.test.ts");
    writeFileSync(aPath, `import {test,expect} from "bun:test"; import {existsSync,writeFileSync} from "node:fs"; test("flaky once",()=>{if(!existsSync(${JSON.stringify(marker)})){writeFileSync(${JSON.stringify(marker)},"seen"); expect(1).toBe(2)} expect(1).toBe(1)});`);
    writeFileSync(bPath, `import {test} from "bun:test"; import {writeFileSync} from "node:fs"; test("other shard runs",()=>writeFileSync(${JSON.stringify(other)},"ran"));`);
    const log = join(dir, "events.tsv");
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => messages.push(args.join(" "));
    try {
      expect(await run({ ...fixtureBudget, dir, root: "tests", shards: 2, timingsPath: join(dir, "t.json"), ledger: ledger(dir, "flaky once"), failureLog: log, changedFiles: [] })).toBe(0);
      expect(existsSync(other)).toBe(true);
      expect(readFileSync(log, "utf8")).toContain("flaky\t");
      expect(messages.join("\n")).toContain("FLAKY");
    } finally { console.log = originalLog; rmSync(dir, { recursive: true, force: true }); }
  });

  test("an expired listed failure is treated as unlisted and red", async () => {
    const dir = fixture({ "a.test.ts": `import {test,expect} from "bun:test"; test("expired red",()=>expect(1).toBe(2));` });
    const l = ledger(dir, "expired red");
    l.flakes[0]!.date_added = "2026-01-01";
    l.flakes[0]!.deadline = "2026-01-08";
    try { expect(await quietRun({ dir, root: "tests", shards: 1, timingsPath: join(dir, "t.json"), ledger: l, changedFiles: [] })).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a listed failure that fails again on its one rerun stays red", async () => {
    const dir = fixture({ "a.test.ts": `import {test,expect} from "bun:test"; test("still red",()=>expect(1).toBe(2));` });
    try { expect(await quietRun({ dir, root: "tests", shards: 1, timingsPath: join(dir, "t.json"), ledger: ledger(dir, "still red"), changedFiles: [] })).not.toBe(0); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a changed test file is not eligible for the ledger rerun", async () => {
    const dir = fixture({ "a.test.ts": `import {test,expect} from "bun:test"; test("changed red",()=>expect(1).toBe(2));` });
    const log = join(dir, "events.tsv");
    try {
      expect(await quietRun({ dir, root: "tests", shards: 1, timingsPath: join(dir, "t.json"), ledger: ledger(dir, "changed red"), changedFiles: ["tests/a.test.ts"], failureLog: log })).not.toBe(0);
      expect(existsSync(log)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a matching test title in another file is ambiguous and stays red", async () => {
    const dir = fixture({ "a.test.ts": "", "b.test.ts": "" });
    const log = join(dir, "events.tsv");
    writeFileSync(join(dir, "tests/a.test.ts"), `import {test,expect} from "bun:test"; test("same title",()=>expect(1).toBe(2));`);
    writeFileSync(join(dir, "tests/b.test.ts"), `import {test,expect} from "bun:test"; test("same title",()=>expect(1).toBe(3));`);
    try {
      expect(await quietRun({ dir, root: "tests", shards: 1, timingsPath: join(dir, "t.json"), ledger: ledger(dir, "same title"), changedFiles: [], failureLog: log })).not.toBe(0);
      expect(existsSync(log)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
