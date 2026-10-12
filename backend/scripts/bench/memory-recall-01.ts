// MEMORY-RECALL-01 runner. Measures (a) the memory judge: recall of facts worth
// keeping, false saves of noise and one-off curiosities, wrong-person attribution;
// (b) recall: right memories and subjects surfaced, including multi-person
// households and a "what about her?" follow-up. Extends judge-eval.ts (same turn
// seeding, runJudgeBatch and judgeScore.ts scorer) and memory/run.ts (same
// disposable-database seeding and cleanup); fixture: datasets/memory-recall-01.json.
//
//   bun run scripts/bench/memory-recall-01.ts --dry-run
//   bun run scripts/bench/memory-recall-01.ts --arm base --reps 3 --out <dir>
//   MAIPAI_MR_VARIANT=<file> bun run scripts/bench/memory-recall-01.ts --arm variant --reps 3 --out <dir>
//   bun run scripts/bench/memory-recall-01.ts --compare <dir>/base.json <dir>/variant.json
//
// Arms: "base" is the shipped code and settings. "variant" applies household
// settings from the JSON file named by MAIPAI_MR_VARIANT ({ "settings": { "key": value } })
// and refuses to run without it, so the two arms can never be the same code under
// two labels. Every repeat (and each arm's own fresh database) starts from the
// identical state: rows added by the previous repeat are removed first (benchDbReset.ts),
// so the judge's duplicate check never sees an earlier repeat's memories.
//
// Not part of check.sh. The live run needs MAIPAI_BACKGROUND_URL (judge) and the
// chat and embed engines named by setup.ts; credential, child and teen rows are
// the deterministic policy check, scored apart and never sent to the judge.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprintDb, restoreDb, snapshotDb } from "./benchDbReset";
import {
  bySplit, countFixture, loadFixture, pairedDelta, passRate, scoreJudgeRow, scorePolicyRow, scoreRecallRow, summarizeJudge, validateFixture,
  type ArmRow, type Fixture, type JudgeRowScore, type PolicyScore,
} from "./memoryRecall01Score";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

interface ArmResult { arm: string; reps: number; judge: ArmRow[]; falseSave: ArmRow[]; attribution: ArmRow[]; recall: ArmRow[]; policy: { id: string; kind: string; pass: boolean }[]; notes: string[] }

function dryRun(fixture: Fixture): void {
  const problems = validateFixture(fixture);
  const counts = countFixture(fixture);
  console.log("MEMORY-RECALL-01 dry run (no model, no database)");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
  const policy = fixture.policy.map((p) => scorePolicyRow(p)).filter((s): s is PolicyScore => s !== null);
  console.log(`  offline policy rows   ${policy.filter((s) => s.pass).length}/${policy.length} pass (child and teen rows are scored live)`);
  if (problems.length) { for (const p of problems) console.error(`  PROBLEM ${p}`); process.exit(1); }
  console.log("fixture valid");
  if (policy.some((s) => !s.pass)) process.exit(1);
}

function compare(aFile: string, bFile: string): void {
  const a = JSON.parse(readFileSync(aFile, "utf8")) as ArmResult;
  const b = JSON.parse(readFileSync(bFile, "utf8")) as ArmResult;
  console.log(`paired 95% bootstrap, ${a.arm} -> ${b.arm} (same-session baseline first)`);
  for (const metric of ["judge", "falseSave", "attribution", "recall"] as const) {
    for (const split of ["tuning", "heldout"] as const) {
      const x = bySplit(a[metric], split), y = bySplit(b[metric], split);
      const d = pairedDelta(x, y);
      console.log(`  ${metric.padEnd(12)} ${split.padEnd(8)} ${pct(passRate(x))} -> ${pct(passRate(y))}  delta ${(d.estimate * 100).toFixed(1)} pts [${(d.low * 100).toFixed(1)}, ${(d.high * 100).toFixed(1)}]`);
    }
  }
  const failed = [...a.policy, ...b.policy].filter((p) => !p.pass);
  console.log(`  policy rows failing  ${failed.length}${failed.length ? ": " + failed.map((p) => p.id).join(", ") : ""}`);
}

async function live(fixture: Fixture): Promise<{ executed: number; engine: string }> {
  // Dynamic imports: "./setup" must load before anything reaching "@/db", and
  // a dry run must never open a database.
  await import("./setup");
  const { finishBench, startBench } = await import("./setup");
  const { sqlite, db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { people, memoryRecords } = await import("@/db/schema");
  const { newPersonId, randomSuffix } = await import("@/lib/id");
  const { nextHlc } = await import("@/lib/hlc");
  const { resolveOrCreateConversation, logTurn } = await import("@/lib/conversationHistory");
  const { runJudgeBatch } = await import("@/lib/memoryJudge");
  const { recall, remember, embedQueryForRecall } = await import("@/lib/memory");
  const { ensureSubjectEntity, registryNameById } = await import("@/lib/subjects");
  const { sanitizeEngineUrl } = await import("@/lib/engineIdentity");
  type PersonRow = import("@/types").PersonRow;

  const arm = flag("--arm") ?? "base";
  if (arm !== "base" && arm !== "variant") { console.error(`unknown arm "${arm}"; use base or variant.`); process.exit(2); }
  const reps = Number(flag("--reps") ?? 3);
  const outDir = flag("--out") ?? join(import.meta.dir, "../../../data-scratch/memory-recall-01");
  const SAFE = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
  const SOURCE = "bench:memory-recall-01";
  await startBench();
  const judgeUrl = process.env.MAIPAI_BACKGROUND_URL;
  if (!judgeUrl || !(await new (await import("@maipai/spec/llm/ts/client.js")).LlamaServerClient(judgeUrl).health())) {
    console.error(`bench setup refused: no judge answers at MAIPAI_BACKGROUND_URL (${sanitizeEngineUrl(judgeUrl ?? "")}); configure a running Stack URL.`);
    process.exit(2);
  }

  if (arm === "variant") {
    const file = process.env.MAIPAI_MR_VARIANT;
    if (!file) { console.error("arm variant needs MAIPAI_MR_VARIANT=<json file with { settings: { key: value } }>; without it variant would be the same code as base."); process.exit(2); }
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const settings = (JSON.parse(readFileSync(file, "utf8")) as { settings?: Record<string, unknown> }).settings ?? {};
    for (const [k, v] of Object.entries(settings)) (setHouseholdSettingValue as (k: string, v: unknown) => unknown)(k, v);
  }
  // The starting state every repeat returns to (after setup and any variant settings).
  const snap = snapshotDb(sqlite);
  const startPrint = fingerprintDb(sqlite, snap);

  const personIds = new Map<string, string>();
  const now = new Date().toISOString();
  const personFor = (name: string, role: string): PersonRow => {
    let id = personIds.get(name);
    if (!id) {
      id = newPersonId();
      personIds.set(name, id);
      sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)").run(id, name, role, randomSuffix(12), now, now, nextHlc());
    }
    return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
  };
  const roleOf = (name: string): string => {
    for (const h of Object.values(fixture.households)) { const p = h.people.find((x) => x.name === name); if (p) return p.role; }
    return "adult";
  };

  const keyOfId = new Map<string, string>();
  const resetState = (): void => {
    restoreDb(sqlite, snap);
    personIds.clear();
    keyOfId.clear();
    const now2 = fingerprintDb(sqlite, snap);
    if (now2 !== startPrint) throw new Error("bench state did not return to its starting point after a reset; the repeat would not be comparable.");
  };

  const result: ArmResult = { arm, reps, judge: [], falseSave: [], attribution: [], recall: [], policy: [], notes: [] };
  const judgeScores: JudgeRowScore[] = [];
  // policy: deterministic, scored apart, never through the judge; runs once, in rep 0's seeded state.
  async function scorePolicy(): Promise<void> {
    for (const row of fixture.policy) {
      if (row.kind === "child" || row.kind === "teen") {
        const h = Object.values(fixture.households).find((x) => x.people.some((p) => p.name === row.speaker))!;
        const actor = personFor(row.speaker, row.kind);
        const memory = h.memories.find((m) => m.key === row.householdMemory)!;
        const matches = recall(actor, `${memory.subject ?? ""} ${memory.text}`, { selfOnly: true, bumpUsage: false });
        const surfaced = matches.some((m) => keyOfId.get(m.record.id) === row.householdMemory);
        const s = scorePolicyRow(row, { surfaced })!;
        result.policy.push(s);
      } else if (row.kind === "credential") {
        const actor = personFor(row.speaker, roleOf(row.speaker));
        const attempt = remember(actor, { text: row.text, category: "fact", tier: "durable", scope: "self", source: `${SOURCE}:policy`, importance: 0.5 });
        result.policy.push(scorePolicyRow(row, { surfaced: false, remembered: attempt.ok })!);
      } else {
        result.policy.push(scorePolicyRow(row)!);
      }
    }
  }


  try {
    // ---- (a) the judge: one fresh set of turns per repeat, one batch per repeat ----
    for (let rep = 0; rep < reps; rep++) {
      resetState();
      const seeded: { row: (typeof fixture.judge)[number]; turnId: string }[] = [];
      for (const row of fixture.judge) {
        const actor = personFor(row.speaker, roleOf(row.speaker));
        const conv = resolveOrCreateConversation(actor, "chat");
        if (!conv.ok) throw new Error(conv.error);
        const turnId = `turn-${randomSuffix(10)}`;
        logTurn(actor, "chat", row.user, { reply: { text: row.reply }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
        seeded.push({ row, turnId });
      }
      const batch = await runJudgeBatch();
      result.notes.push(`rep ${rep}: judge processed ${batch.processed}, wrote ${batch.factsWritten}`);
      for (const { row, turnId } of seeded) {
        const extracted = db.select({ text: memoryRecords.text }).from(memoryRecords).where(eq(memoryRecords.source, turnId)).all().map((r) => r.text);
        const s = scoreJudgeRow(row, extracted);
        judgeScores.push(s);
        if (row.kind === "noise" || row.kind === "curiosity") result.falseSave.push({ id: row.id, rep, ok: s.falsePositives === 0 });
        else if (row.kind === "possessive") result.attribution.push({ id: row.id, rep, ok: s.wrongPerson.length === 0 && s.misses === 0 });
        else result.judge.push({ id: row.id, rep, ok: s.misses === 0 });
      }
    }

    // ---- (b) recall: per repeat, a clean database, seed each household's memories directly, query as the speaker ----
    // Phase 2 note: the follow-up arm below prepends the prior question; swap in the
    // turn engine's own subject-stack resolution when measuring the shipped path.
    for (let rep = 0; rep < reps; rep++) {
      resetState();
      for (const [hid, h] of Object.entries(fixture.households)) {
        for (const m of h.memories) {
          const owner = personFor(h.people[0]!.name, h.people[0]!.role);
          let subjectId: string | null = null;
          if (m.subject) {
            const kind = h.pets.includes(m.subject) ? "pet" : "person";
            const ent = ensureSubjectEntity(owner, { name: m.subject, kind }, true);
            if (!ent.ok || !ent.value) throw new Error(`subject ${m.subject}: ${ent.ok ? "no entity" : ent.error}`);
            subjectId = ent.value.id;
          }
          const created = remember(owner, { text: m.text, category: m.category, tier: "durable", scope: "household", subject_id: subjectId, source: `${SOURCE}:${hid}`, importance: 0.7, child_disclosure: m.childDisclosure ?? "child_ok" });
          if (!created.ok) throw new Error(`seed ${m.key}: ${created.error}`);
          keyOfId.set(created.value.id, m.key);
        }
      }
      for (const row of fixture.recall) {
        const actor = personFor(row.speaker, roleOf(row.speaker));
        const query = row.followUp ? `${row.followUp.prior} ${row.query}` : row.query;
        const vector = await embedQueryForRecall(query);
        const matches = recall(actor, query, { selfOnly: true, bumpUsage: false, queryVector: vector });
        const keys = matches.map((m) => keyOfId.get(m.record.id)).filter((k): k is string => !!k && fixture.households[row.household]!.memories.some((x) => x.key === k));
        const subjects = matches.map((m) => (m.record.subject_id ? registryNameById(m.record.subject_id) : null)).filter((n): n is string => !!n);
        const s = scoreRecallRow(row, keys, subjects);
        result.recall.push({ id: row.id, rep, ok: s.pass });
      }
      if (rep === 0) await scorePolicy();
    }

    const j = summarizeJudge(judgeScores);
    console.log(`\n=== MEMORY-RECALL-01 ${arm}, ${reps} repeats ===`);
    console.log(`Judge recall ${pct(j.recall)}; false saves ${j.falseSaves} over ${j.noiseRows} noise rows; attribution accuracy ${pct(j.attributionAccuracy)} (${j.wrongAttributionRows}/${j.attributionRows} rows wrong)`);
    for (const split of ["tuning", "heldout"] as const) console.log(`Recall ${split} pass ${pct(passRate(bySplit(result.recall, split)))}`);
    console.log(`Policy rows failing: ${result.policy.filter((p) => !p.pass).map((p) => p.id).join(", ") || "none"}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${arm}.json`), JSON.stringify(result, null, 2));
    console.log(`wrote ${join(outDir, `${arm}.json`)}`);
    return { executed: result.judge.length + result.falseSave.length + result.attribution.length + result.recall.length, engine: `judge at ${sanitizeEngineUrl(judgeUrl)}` };
  } finally {
    resetState();
  }
}

const fixture = loadFixture();
if (args.includes("--dry-run")) dryRun(fixture);
else if (args.includes("--compare")) compare(flag("--compare")!, args[args.indexOf("--compare") + 2]!);
else {
  const problems = validateFixture(fixture);
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const { finishBench } = await import("./setup");
  let summary = { executed: 0, engine: "not run" };
  try { summary = await live(fixture); } finally { /* live() cleans its own rows */ }
  finishBench(summary);
}
