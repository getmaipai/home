import { describe, expect, test } from "bun:test";
import { activityOf, approvalWords, fileTreeOf, isBusy } from "./codeTranscript";
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
