// THIN-0H (rule 12, ported before deleted): nothing under turnMachine/
// may depend on the old turnEngine.ts, so the old file can be deleted
// (THIN-7D) without touching the default path. The parent notifier and the
// stream-refusal types the default path uses live in turnShared.ts.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { StreamSafetyRefusal, StreamUnavailable, notifyOncePerTurn } from "@/lib/turnShared";
import * as oldEngine from "@/lib/turnEngine";

const ROOT = join(import.meta.dir, "../../src/lib/turnMachine");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("the default path does not depend on the old turn engine", () => {
  test("no file under turnMachine/ mentions turnEngine", () => {
    const offenders = sourceFiles(ROOT).filter((path) => readFileSync(path, "utf8").includes("turnEngine"));
    expect(offenders).toEqual([]);
  });

  test("the old engine still exports the same notifier and refusal types (one definition, re-exported)", () => {
    expect(oldEngine.notifyOncePerTurn).toBe(notifyOncePerTurn);
    expect(oldEngine.StreamSafetyRefusal).toBe(StreamSafetyRefusal);
    expect(oldEngine.StreamUnavailable).toBe(StreamUnavailable);
  });
});
