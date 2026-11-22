import { describe, expect, test } from "bun:test";
import { parseChangeCounts, readChangeCounts } from "@/lib/codingChanges";

describe("Changes count", () => {
  test("tracked edits, untracked files and binaries add up", () => {
    expect(parseChangeCounts("3\t1\ta.ts\n-\t-\timg.png\n1\t0\thello.txt\n")).toEqual({ files: 3, additions: 4, deletions: 1 });
    expect(parseChangeCounts("")).toEqual({ files: 0, additions: 0, deletions: 0 });
    expect(parseChangeCounts("warning: not a row\n")).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
  test("read through the sandbox's exec; a failure or no exec says nothing", async () => {
    const ok = async function* () { yield { stream: "stdout" as const, text: "1\t0\thello.txt\n" }; yield { exit: 0 }; };
    expect(await readChangeCounts(ok, "csess-aaaaaa")).toEqual({ files: 1, additions: 1, deletions: 0 });
    const bad = async function* () { yield { exit: 128 }; };
    expect(await readChangeCounts(bad, "csess-aaaaaa")).toBeNull();
    const boom = async function* () { throw new Error("x"); yield { exit: 0 }; };
    expect(await readChangeCounts(boom as never, "csess-aaaaaa")).toBeNull();
    expect(await readChangeCounts(undefined, "csess-aaaaaa")).toBeNull();
  });
});
