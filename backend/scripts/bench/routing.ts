// Routing corpus bench: reports literal-pattern behavior separately from
// the model's semantic tool choice. Only exact-pattern positives are
// deterministic routing expectations after D7.
//
// Usage: bun run scripts/bench/routing.ts
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllManifests, route, matchPattern } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import { SPEC_DIR } from "@/lib/specDir";

interface CorpusRow {
  utterance: string;
  expect: string | null;
  args?: Record<string, unknown>;
  must_not: string[];
  note?: string;
}

const corpus: CorpusRow[] = JSON.parse(
  readFileSync(join(SPEC_DIR, "llm", "routing-corpus.json"), "utf-8"),
);

function benchActor(): PersonRow {
  return {
    id: "person-bench",
    displayName: "Bench",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: "seed",
    source: "hub",
    localOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    hlc: "1700000000000:0:bench",
  };
}

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  const actor = benchActor();
  const loaded = loadAllManifests();
  console.log(`Running ${corpus.length} routing-corpus rows...\n`);
  const exactRows = corpus.filter((row) => !!row.expect && loaded
    .find((candidate) => candidate.id === row.expect)?.manifest.routing?.patterns
    ?.some((pattern) => matchPattern(row.utterance, pattern)));
  let pass = 0;
  for (const row of exactRows) {
    const { winner } = await route(row.utterance, actor, loaded);
    const routedId = winner?.id ?? null;
    const ok = routedId === row.expect && !row.must_not.includes(routedId ?? "");
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${row.utterance}" -> expected ${row.expect}, got ${routedId ?? "null"}`);
  }
  console.log(`\n${pass}/${exactRows.length} exact-pattern rows passed; ${corpus.length - exactRows.length} semantic/null rows excluded.\n`);
  return { executed: exactRows.length, engine: `literal-pattern corpus ${exactRows.length}/${exactRows.length}` };
}

let summary = { executed: 0, engine: "not run" };
try {
  summary = await main();
} finally {
  // No external embedder is started by this literal-pattern bench.
}
finishBench(summary);
