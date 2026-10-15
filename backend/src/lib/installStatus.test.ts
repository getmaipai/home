import { expect, test } from "bun:test";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { summarizeInstall } from "./installStatus";

let n = 0;
function job(model: string, role: string, state: StackJob["state"], done: number, total: number, extra: Partial<StackJob> = {}): StackJob {
  n += 1;
  const at = `2026-10-15T10:00:${String(n).padStart(2, "0")}.000Z`;
  return { id: `j${n}`, kind: "model.install", role, state, percent: 0, completedBytes: done, totalBytes: total, status: state, position: null, input: { model }, result: null, reason: null, createdAt: at, updatedAt: at, ...extra };
}

test("no install jobs reads as none", () => {
  expect(summarizeInstall([]).state).toBe("none");
  expect(summarizeInstall([{ ...job("x", "chat", "done", 1, 1), kind: "voice.preview" }]).state).toBe("none");
});

test("downloading until chat lands, then starter_ready, then ready", () => {
  const a = summarizeInstall([job("chat", "chat", "running", 50, 100, { bytesPerSecond: 10 }), job("stt", "stt", "queued", 0, 100)]);
  expect(a.state).toBe("downloading");
  expect(a.chatReady).toBe(false);
  expect(a.percent).toBe(25);
  expect(a.etaSeconds).toBe(15);
  const b = summarizeInstall([job("chat", "chat", "done", 100, 100), job("stt", "stt", "running", 10, 100)]);
  expect(b.state).toBe("starter_ready");
  expect(b.chatReady).toBe(true);
  const c = summarizeInstall([job("chat", "chat", "done", 100, 100), job("stt", "stt", "done", 100, 100)]);
  expect(c.state).toBe("ready");
  expect(c.complete).toBe(true);
  expect(c.percent).toBe(100);
});

test("stalled, failed and out of space carry a plain problem", () => {
  expect(summarizeInstall([job("chat", "chat", "stalled", 5, 100)]).state).toBe("stalled");
  const failed = summarizeInstall([job("chat", "chat", "failed", 5, 100, { reason: "boom" })]);
  expect(failed.state).toBe("failed");
  expect(failed.problem).toContain("Try again");
  const full = summarizeInstall([job("chat", "chat", "failed", 5, 100, { reason: "ENOSPC: no space left on device" })]);
  expect(full.state).toBe("out_of_space");
  expect(full.problem).toContain("room");
});

test("a retry replaces the earlier failure for the same model", () => {
  const status = summarizeInstall([job("chat", "chat", "failed", 5, 100, { reason: "boom" }), job("chat", "chat", "running", 20, 100)]);
  expect(status.state).toBe("downloading");
  expect(status.items).toHaveLength(1);
});
