import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type GateStage = { stage: string; seconds: number };
export type GateRun = {
  ts: string;
  ended_at: string;
  worktree: string;
  scope: string;
  scope_reason: string;
  run_kind: "gate" | "pre";
  seconds: number;
  exit: number;
  first_red_stage: string | null;
  failing_test_names: string[];
  flaky_tests: { test: string; owner: string; deadline: string; first_failure: string }[];
  load_at_lock_time: string | null;
  lock_wait_seconds: number;
  head: string;
  merge_base: string;
  lane: string;
  stages: GateStage[];
};

export type GateRunInput = Omit<GateRun, "run_kind" | "seconds" | "first_red_stage" | "failing_test_names" | "flaky_tests" | "stages"> & {
  run_kind: "gate" | "pre";
  start_epoch: number;
  stages_log: string;
  failures_log: string;
};

function lines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function parseStages(source: string): GateStage[] {
  return source.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [stage, seconds] = line.split("\t");
    const parsed = Number(seconds);
    return stage && Number.isFinite(parsed) ? [{ stage, seconds: parsed }] : [];
  });
}

export function parseFailures(source: string): { stage: string | null; tests: string[]; flakes: { test: string; owner: string; deadline: string; first_failure: string }[] } {
  let stage: string | null = null;
  const tests: string[] = [];
  const flakes: { test: string; owner: string; deadline: string; first_failure: string }[] = [];
  for (const line of source.split(/\r?\n/)) {
    const [kind, value, owner, deadline, first_failure] = line.split("\t");
    if (kind === "fail" && stage === null) stage = value || null;
    if (kind === "test" && value && !tests.includes(value)) tests.push(value);
    if (kind === "flaky" && value) flakes.push({ test: value, owner: owner ?? "unknown", deadline: deadline ?? "", first_failure: first_failure ?? "" });
  }
  return { stage, tests, flakes };
}

export function makeGateRun(input: GateRunInput, endedAt = new Date()): GateRun {
  const stages = parseStages(input.stages_log);
  const failures = parseFailures(input.failures_log);
  const end = endedAt.toISOString();
  return {
    ts: input.ts,
    ended_at: end,
    worktree: input.worktree,
    scope: input.scope,
    scope_reason: input.scope_reason,
    run_kind: input.run_kind,
    seconds: Math.max(0, Math.round(endedAt.getTime() / 1000 - input.start_epoch)),
    exit: input.exit,
    first_red_stage: failures.stage,
    failing_test_names: failures.tests,
    flaky_tests: failures.flakes,
    load_at_lock_time: input.load_at_lock_time || null,
    lock_wait_seconds: input.lock_wait_seconds,
    head: input.head,
    merge_base: input.merge_base,
    lane: input.lane,
    stages,
  };
}

export function appendGateRun(path: string, input: GateRunInput, endedAt = new Date()): GateRun {
  const record = makeGateRun(input, endedAt);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

if (import.meta.main) {
  const [output, stagesLog, failuresLog] = Bun.argv.slice(2);
  if (!output || !stagesLog || !failuresLog) {
    console.error("usage: bun scripts/gate/stats.ts <runs.jsonl> <stages.log> <failures.log>");
    process.exit(2);
  }
  const env = process.env;
  const startEpoch = Number(env.GATE_STATS_START_EPOCH);
  if (!Number.isFinite(startEpoch)) {
    console.error("GATE_STATS_START_EPOCH is missing or invalid");
    process.exit(2);
  }
  appendGateRun(output, {
    run_kind: (env.GATE_STATS_KIND === "pre" ? "pre" : "gate"),
    ts: env.GATE_STATS_TS ?? new Date().toISOString(),
    start_epoch: startEpoch,
    ended_at: "",
    worktree: env.GATE_STATS_WORKTREE ?? "unknown",
    scope: env.GATE_STATS_SCOPE ?? "unknown",
    scope_reason: env.GATE_STATS_SCOPE_REASON ?? "unknown",
    exit: Number(env.GATE_STATS_EXIT ?? 1),
    load_at_lock_time: env.GATE_STATS_LOAD ?? "",
    lock_wait_seconds: Number(env.GATE_STATS_LOCK_WAIT ?? 0),
    head: env.GATE_STATS_HEAD ?? "unknown",
    merge_base: env.GATE_STATS_MERGE_BASE ?? "",
    lane: env.GATE_STATS_LANE ?? "unknown",
    stages_log: lines(stagesLog).join("\n"),
    failures_log: lines(failuresLog).join("\n"),
  });
}
