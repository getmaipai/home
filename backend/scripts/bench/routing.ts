// Routing corpus bench (session-c-brain-and-voice.md step 1): runs
// spec/llm/routing-corpus.json through the real Tier 1 embedding path -
// backend/tests/routingCorpus.test.ts runs the identical corpus against
// the stub embedder as part of scripts/check.sh; this is the same
// exercise against whatever real embed backend the machine resolves
// (MAIPAI_EMBED_URL, or a spawned llama-server once a chat model has been
// downloaded - see docs/dev/session-c.md's step 0 for exactly how to
// point one at this). Prints precision and recall per package, not just
// a pass count: this step's own text says "measure on the corpus before
// trusting" TIER1_THRESHOLD/TIER1_MARGIN, and a single pass/fail number
// can't say which package (or which direction - false fire vs missed
// fire) is actually driving a bad number.
//
// Usage: bun run scripts/bench/routing.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllManifests, route, matchingSkills } from "@/lib/turnEngine";
import { loadAllSkills } from "@/lib/skills";
import { getEmbedBackendKind, __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { embedUtterance } from "@/lib/routing";
import type { PersonRow } from "@/types";

interface CorpusRow {
  utterance: string;
  expect: string | null;
  args?: Record<string, unknown>;
  must_not: string[];
  note?: string;
}

const corpus: CorpusRow[] = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "spec", "llm", "routing-corpus.json"), "utf-8"),
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

interface PackageStats {
  truePositives: number; // corpus rows expecting this package, correctly routed here
  falseNegatives: number; // corpus rows expecting this package, routed elsewhere or null
  falsePositives: number; // corpus rows expecting something else, wrongly routed here
}

async function main() {
  const actor = benchActor();
  const loaded = loadAllManifests();
  const skills = loadAllSkills();

  // Same reason memory-eval.ts's own bench warms the embed backend
  // before reporting which one is active: right after the first
  // ensureRoutingEmbeddings() call inside route(), getEmbedBackendKind()
  // might still read "starting."
  await embedUtterance("warm the embed backend");
  console.log(`Embed backend: ${getEmbedBackendKind()}`);
  console.log(`Running ${corpus.length} routing-corpus rows...\n`);

  const stats = new Map<string, PackageStats>();
  function statsFor(id: string): PackageStats {
    let s = stats.get(id);
    if (!s) {
      s = { truePositives: 0, falseNegatives: 0, falsePositives: 0 };
      stats.set(id, s);
    }
    return s;
  }

  // Fix D (docs/dev.md's "Chat reliability: the 2026-09-07 incident and
  // the five fixes"): TIER1_THRESHOLD/TIER2_AMBIGUOUS_FLOOR were both
  // start values, never measured against a real embedder - this is that
  // measurement. `nullTopScores` is the number that actually matters for
  // setting them: for every corpus row that should route NOWHERE, how
  // close did the single best-scoring (wrong) candidate come to firing
  // anyway. A threshold below this distribution's own p95 fires on
  // ordinary conversation; one above every positive row's own score
  // never fires on anything real either.
  const nullTopScores: number[] = [];
  let pass = 0;
  for (const row of corpus) {
    const { winner: routed, ranked } = await route(row.utterance, actor, loaded);
    const skillMatches = matchingSkills(row.utterance, skills);
    const routedId = routed ? routed.id : (skillMatches[0]?.skill.manifest.id ?? null);

    const ok = routedId === row.expect && !row.must_not.includes(routedId ?? "");
    if (ok) pass++;

    if (row.expect) {
      if (routedId === row.expect) statsFor(row.expect).truePositives++;
      else statsFor(row.expect).falseNegatives++;
    }
    if (routedId && routedId !== row.expect) statsFor(routedId).falsePositives++;

    const top3 = ranked
      .slice(0, 3)
      .map((r) => `${r.id}:${r.score.toFixed(2)}`)
      .join(" ");
    if (row.expect === null && ranked[0]) nullTopScores.push(ranked[0].score);
    console.log(`${ok ? "PASS" : "FAIL"}  "${row.utterance}" -> expected ${row.expect ?? "null"}, got ${routedId ?? "null"}${top3 ? `  [${top3}]` : ""}`);
  }

  console.log(`\n${pass}/${corpus.length} passed\n`);
  console.log("Per-package precision/recall:");
  for (const [id, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const precision = s.truePositives + s.falsePositives === 0 ? null : s.truePositives / (s.truePositives + s.falsePositives);
    const recall = s.truePositives + s.falseNegatives === 0 ? null : s.truePositives / (s.truePositives + s.falseNegatives);
    console.log(
      `  ${id.padEnd(20)} precision=${precision === null ? "n/a" : precision.toFixed(2)}  recall=${recall === null ? "n/a" : recall.toFixed(2)}  (tp=${s.truePositives} fp=${s.falsePositives} fn=${s.falseNegatives})`,
    );
  }

  if (nullTopScores.length > 0) {
    const sorted = [...nullTopScores].sort((a, b) => a - b);
    const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!.toFixed(3);
    console.log(`\nNull-row noise floor (${sorted.length} rows, top wrong-package score):`);
    console.log(`  p50=${quantile(0.5)} p90=${quantile(0.9)} p95=${quantile(0.95)} max=${sorted[sorted.length - 1]!.toFixed(3)}`);
    console.log(`  TIER1_THRESHOLD/TIER2_AMBIGUOUS_FLOOR should sit at or above p95 of this distribution.`);
  }
}

try {
  await main();
} finally {
  // memory-eval.ts's own found-live lesson: nothing else stops a real
  // spawned/stub embed backend on its own, so this script never exits
  // without calling this itself.
  __resetEmbedSupervisorForTests();
}
