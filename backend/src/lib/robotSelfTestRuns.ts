import { randomUUID } from "node:crypto";
import { RobotSelfTestResult, type RobotSelfTestResult as RobotSelfTestResultShape } from "@maipai/spec/gen/ts/robot-self-test-result.js";
import { issueDeviceCommand } from "./deviceCommands";
import type { RobotSelfTestPart } from "./robotSelfTest";

export const ROBOT_SELF_TEST_TIMEOUT_MS = 15_000;
export const ROBOT_SELF_TEST_RESULT_TTL_MS = 10 * 60_000;

interface PendingRun {
  deviceId: string;
  part: RobotSelfTestPart;
  expiresAt: number;
  resolve: (result: RobotSelfTestResultShape | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRun>();
const results = new Map<string, { result: RobotSelfTestResultShape; expiresAt: number }>();
let timeoutForTests: number | null = null;

export function startRobotSelfTest(
  deviceId: string,
  part: RobotSelfTestPart,
  options: { timeoutMs?: number; now?: () => number } = {},
): { runId: string; result: Promise<RobotSelfTestResultShape | null> } {
  pruneRobotSelfTests();
  const runId = randomUUID();
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? timeoutForTests ?? ROBOT_SELF_TEST_TIMEOUT_MS;
  let resolve!: (result: RobotSelfTestResultShape | null) => void;
  const result = new Promise<RobotSelfTestResultShape | null>((done) => { resolve = done; });
  const timer = setTimeout(() => {
    pending.delete(runId);
    resolve(null);
  }, timeoutMs);
  pending.set(runId, { deviceId, part, expiresAt: now() + ROBOT_SELF_TEST_RESULT_TTL_MS, resolve, timer });
  issueDeviceCommand(deviceId, "self_test", { run_id: runId, part }, 20_000);
  return { runId, result };
}

export function acceptRobotSelfTestResult(deviceId: string, value: unknown): "accepted" | "unknown" | "invalid" {
  const parsed = RobotSelfTestResult.safeParse(value);
  if (!parsed.success) return "invalid";
  pruneRobotSelfTests();
  const run = pending.get(parsed.data.run_id);
  if (!run || run.deviceId !== deviceId || run.part !== parsed.data.part) return "unknown";
  pending.delete(parsed.data.run_id);
  clearTimeout(run.timer);
  results.set(parsed.data.run_id, { result: parsed.data, expiresAt: Date.now() + ROBOT_SELF_TEST_RESULT_TTL_MS });
  run.resolve(parsed.data);
  return "accepted";
}

export function pruneRobotSelfTests(now = Date.now()): void {
  for (const [runId, entry] of results) if (entry.expiresAt <= now) results.delete(runId);
  for (const [runId, run] of pending) {
    if (run.expiresAt <= now) {
      clearTimeout(run.timer);
      pending.delete(runId);
      run.resolve(null);
    }
  }
}


export function __resetRobotSelfTestsForTests(): void {
  for (const run of pending.values()) {
    clearTimeout(run.timer);
    run.resolve(null);
  }
  pending.clear();
  results.clear();
  timeoutForTests = null;
}

export function __setRobotSelfTestTimeoutForTests(timeoutMs: number): void { timeoutForTests = timeoutMs; }
