// MEMORY-FIX-01 step 1 trace (untracked, bench-only). Per failing row: what the judge
// extracted / dropped, and what recall returned with cosine, score and key.
// MEMORY_TRACE_OUT=<file> bun run scripts/bench/memory-recall-01-trace.ts
import { writeFileSync } from "node:fs";
import { loadFixture } from "./memoryRecall01Score";

const JUDGE_ROWS = new Set(["j11", "j12", "j13", "j14", "j15", "j16", "j17", "j18", "j23", "j27"]);
const out: string[] = [];
const P = (s: string) => { out.push(s); console.log(s); };

await import("./setup");
const { startBench } = await import("./setup");
const { sqlite, db } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { people, memoryRecords } = await import("@/db/schema");
const { newPersonId, randomSuffix } = await import("@/lib/id");
const { nextHlc } = await import("@/lib/hlc");
const { resolveOrCreateConversation, logTurn } = await import("@/lib/conversationHistory");
const { runJudgeBatch } = await import("@/lib/memoryJudge");
const { recall, remember, embedQueryForRecall } = await import("@/lib/memory");
const { ensureSubjectEntity, registryNameById } = await import("@/lib/subjects");
type PersonRow = import("@/types").PersonRow;
const fixture = loadFixture();
await startBench();

// capture console lines and raw judge responses
const logs: string[] = [];
const origLog = console.log;
console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
const raws: { user: string; content: string }[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const res = await origFetch(input, init);
  try {
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (body?.messages && !body.input) {
      const clone = res.clone();
      const j: any = await clone.json();
      const content = j?.choices?.[0]?.message?.content;
      if (typeof content === "string") raws.push({ user: JSON.stringify(body.messages.slice(-1)[0]?.content ?? "").slice(0, 400), content });
    }
  } catch { /* ignore */ }
  return res;
}) as typeof fetch;

const SAFE = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const personIds = new Map<string, string>();
const now = new Date().toISOString();
const roleOf = (name: string): string => { for (const h of Object.values(fixture.households)) { const p = h.people.find((x) => x.name === name); if (p) return p.role; } return "adult"; };
const personFor = (name: string, role: string): PersonRow => {
  let id = personIds.get(name);
  if (!id) { id = newPersonId(); personIds.set(name, id); sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)").run(id, name, role, randomSuffix(12), now, now, nextHlc()); }
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
};

// ---- judge, 1 rep, only the traced rows (each as its own turn) ----
const REPS = Number(process.env.MEMORY_TRACE_REPS ?? 2);
for (let rep = 0; rep < REPS; rep++) {
  for (const row of fixture.judge.filter((j) => JUDGE_ROWS.has(j.id))) {
    const actor = personFor(row.speaker, roleOf(row.speaker));
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = `turn-${randomSuffix(10)}`;
    logTurn(actor, "chat", row.user, { reply: { text: row.reply }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
    const before = raws.length, lb = logs.length;
    await runJudgeBatch();
    const stored = db.select({ text: memoryRecords.text, subjectId: memoryRecords.subjectId, recordKind: memoryRecords.recordKind }).from(memoryRecords).where(eq(memoryRecords.source, turnId)).all();
    P(`### JUDGE ${row.id} rep${rep} speaker=${row.speaker} kind=${row.kind}\n  user: ${row.user}\n  expected: ${JSON.stringify(row.expected)}\n  raw model output: ${raws.slice(before).map((r) => r.content.replace(/\s+/g, " ").slice(0, 700)).join(" || ") || "(none captured)"}\n  stored: ${JSON.stringify(stored.map((s) => [s.recordKind, s.text]))}\n  logs: ${logs.slice(lb).filter((l) => l.includes(turnId) || l.startsWith("[memoryJudge]")).join(" | ")}`);
  }
}

// ---- recall: seed, query, dump top 8 ----
const keyOfId = new Map<string, string>();
const textOf = new Map<string, string>();
for (const [hid, h] of Object.entries(fixture.households)) {
  for (const m of h.memories) {
    const owner = personFor(h.people[0]!.name, h.people[0]!.role);
    let subjectId: string | null = null;
    if (m.subject) {
      const ent = ensureSubjectEntity(owner, { name: m.subject, kind: h.pets.includes(m.subject) ? "pet" : "person" }, true);
      if (!ent.ok || !ent.value) throw new Error("subject");
      subjectId = ent.value.id;
    }
    const created = remember(owner, { text: m.text, category: m.category as any, tier: "durable", scope: "household", subject_id: subjectId, source: `bench:trace:${hid}`, importance: 0.7, child_disclosure: m.childDisclosure ?? "child_ok" });
    if (!created.ok) throw new Error(created.error);
    keyOfId.set(created.value.id, m.key); textOf.set(m.key, m.text);
  }
}
P("## entities: " + JSON.stringify(sqlite.query("SELECT name, scope, person, source FROM entities").all()));
const embCountNow = () => (sqlite.query("SELECT count(*) c FROM memory_embeddings").get() as { c: number }).c;
P(`## recall seed: ${keyOfId.size} memories, ${embCountNow()} stored embeddings right after seeding`);
const cosine = (a: Float32Array, b: Float32Array) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; } return d / Math.sqrt(na * nb); };
const { scoreRecallRow } = await import("./memoryRecall01Score");
const runPass = async (label: string, detail: Set<string> | null) => {
  P(`## PASS ${label}`);
  for (const row of fixture.recall) {
    const actor = personFor(row.speaker, roleOf(row.speaker));
    const query = row.followUp ? `${row.followUp.prior} ${row.query}` : row.query;
    const qv = await embedQueryForRecall(query);
    const nEmb = embCountNow();
    const matches = recall(actor, query, { selfOnly: true, bumpUsage: false, queryVector: qv });
    const keys = matches.map((m) => keyOfId.get(m.record.id)).filter((k): k is string => !!k && fixture.households[row.household]!.memories.some((x) => x.key === k));
    const subjects = matches.map((m) => (m.record.subject_id ? registryNameById(m.record.subject_id) : null)).filter((n): n is string => !!n);
    const sc = scoreRecallRow(row, keys, subjects);
    P(`${row.id} ${sc.pass ? "pass" : "FAIL"} hit=${sc.hit} leak=${sc.leak} subjOk=${sc.subjectOk} embeddings=${nEmb} top5=${keys.slice(0, 5).join(",")}`);
    if (!detail || !detail.has(row.id)) continue;
    const vecs = new Map((sqlite.query("SELECT memory_id, vector FROM memory_embeddings").all() as { memory_id: string; vector: Uint8Array }[]).map((v) => { const u = new Uint8Array(v.vector); return [v.memory_id, new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4)] as const; }));
    P(`  query="${query}" expect=${row.expect} forbid=${row.forbid} subject=${row.subject}${row.abstain ? " ABSTAIN" : ""}; subjects returned=${[...new Set(subjects)].join(",")}`);
    matches.slice(0, 8).forEach((m, i) => {
      const k = keyOfId.get(m.record.id) ?? "?";
      const v = vecs.get(m.record.id);
      const cos = qv && v && v.length === qv.vector.length ? cosine(qv.vector, v).toFixed(3) : "n/a";
      P(`   ${i + 1}. ${k.padEnd(18)} score=${m.score.toFixed(3)} cos=${cos} force=${m.forceInclude} ${row.expect.includes(k) ? "<EXPECT" : row.forbid.includes(k) ? "<FORBID" : ""}`);
    });
    for (const e of row.expect) {
      const id = [...keyOfId].find(([, kk]) => kk === e)![0]; const vv = vecs.get(id);
      const idx = matches.findIndex((m) => m.record.id === id);
      P(`  expected ${e}: rank ${idx < 0 ? "ABSENT" : idx + 1}, cos ${qv && vv ? cosine(qv.vector, vv).toFixed(3) : "n/a"}`);
    }
  }
};
const FAIL = new Set(["r02", "r03", "r06", "r08", "r14", "r15", "r16", "r21", "r26"]);


P(`## after wait: ${embCountNow()}/${keyOfId.size} embeddings stored`);
await runPass("B (all embeddings present)", FAIL);
console.log = origLog;
writeFileSync(process.env.MEMORY_TRACE_OUT ?? "/tmp/memtrace.txt", out.join("\n"));
process.exit(0);
