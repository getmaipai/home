import { describe, expect, test } from "bun:test";
import { activityOf, approvalWords, fileTreeOf, isBusy, languageOf, outputLines, parseDiff } from "./codeTranscript";
import type { CodeMessage } from "./codeApi";

const msg = (seq: number, parts: CodeMessage["parts"]): CodeMessage => ({ id: `m${seq}`, seq, role: "agent", parts, created_at: "2026-11-21T10:00:00.000Z" });

describe("activityOf", () => {
  test("reads commands, files and the latest plan from the transcript", () => {
    const a = activityOf([
      msg(1, [{ type: "plan", items: [{ text: "a", done: true }, { text: "b", done: false }] }, { type: "tool", tool: "file_write", status: "done", summary: "src/a.ts" }]),
      msg(2, [{ type: "tool", tool: "command", status: "failed", summary: "bun test", exit_code: 1 }, { type: "tool", tool: "file_write", status: "done", summary: "src/a.ts" }, { type: "plan", items: [{ text: "a", done: true }, { text: "b", done: true }] }]),
    ]);
    expect(a.files).toEqual(["src/a.ts"]);
    expect(a.commands.map((c) => [c.command, c.exitCode, c.status])).toEqual([["bun test", 1, "failed"]]);
    expect(a.plan).toEqual({ steps: ["a", "b"], done: 2 });
  });
  test("an empty transcript has nothing", () => {
    expect(activityOf([])).toEqual({ commands: [], files: [], plan: null });
  });
});

test("fileTreeOf lists each folder once, ahead of its files", () => {
  expect(fileTreeOf(["src/b.ts", "src/lib/a.ts"]).map((n) => `${n.depth}:${n.kind}:${n.path}`)).toEqual(["0:folder:src", "1:file:src/b.ts", "1:folder:src/lib", "2:file:src/lib/a.ts"]);
});

test("a held request that only the person may start is named in plain words", () => {
  for (const effect of ["push", "pull_request", "host_new", "delete_session"]) expect(approvalWords(effect).title.endsWith("?")).toBe(true);
});

test("a session is busy while queued, starting, working or waiting on the person", () => {
  expect(["queued", "starting", "working", "needs_you"].every((s) => isBusy(s as never))).toBe(true);
  expect(["idle", "done", "failed", "paused", "archived"].some((s) => isBusy(s as never))).toBe(false);
});

test("a unified diff splits per file with line numbers, and hunk headers are not rows", () => {
  const diff = "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3,2 +3,3 @@ fn\n keep\n-old\n+new\n+more\n";
  expect(parseDiff(diff)["src/a.ts"]).toEqual([{ kind: "context", text: "keep", line: 3 }, { kind: "removed", text: "old", line: 4 }, { kind: "added", text: "new", line: 4 }, { kind: "added", text: "more", line: 5 }]);
});

test("command output becomes terminal lines, and a cut marker is reported", () => {
  expect(outputLines("a\nb\n")).toEqual({ lines: ["a", "b"], truncated: false });
  expect(outputLines("[earlier output cut]\nz").truncated).toBe(true);
  expect(outputLines(undefined)).toEqual({ lines: [], truncated: false });
  expect(languageOf("x/y.tsx")).toBe("tsx");
});
