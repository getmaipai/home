// THIN-0H and THIN-7D (rule 12): the old turn engine is deleted, and nothing
// under turnMachine/ may name it. The parent notifier and the stream-refusal
// types the default path uses live in turnShared.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Built from parts so this guard does not itself match the grep it enforces.
const OLD_ENGINE = ["turn", "Engine"].join("");
const ROOT = join(import.meta.dir, "../../src/lib/turnMachine");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("the default path does not depend on the old turn engine", () => {
  test("no file under turnMachine/ names the old engine", () => {
    const offenders = sourceFiles(ROOT).filter((path) => readFileSync(path, "utf8").includes(OLD_ENGINE));
    expect(offenders).toEqual([]);
  });

  test("the old engine files are deleted (THIN-7D, rule 12): one path, not hidden behind a setting", () => {
    for (const name of [`${OLD_ENGINE}.ts`, "turnBareStream.ts", "bareCompletion.ts"]) {
      expect(existsSync(join(ROOT, "..", name))).toBe(false);
    }
  });
});
