#!/usr/bin/env bun
// Lane 14 item 2 (docs/plans/session-b-lane-14-2026-09-14.md): EVAL-07's
// memory replay - the public baseline, built now, run only once the
// coordinator says "clear" (it uses the real engines, a hold like a
// seeded set). Drives the household engine through the same entry
// points the live bench uses (setup.ts, the recording proxy,
// conversationRunner.ts's own exported helpers) - imported, never
// edited, same as conversationLive.ts's own import order rule: the
// proxy starts before setup.ts reads MAIPAI_LLAMA_SERVER_URL, and
// setup.ts loads before anything reaches "@/db".
//
// Design, fixed (the item's own text): ingestion is the memory path,
// not the chat path. Each history session becomes a conversation on a
// seeded household member; the dataset's own "user" turns are logged
// as that person's own turns, the other side's turns as the hub's own
// reply text on the same row - never generated, no chat completion
// spent on history. The real judge runs on the ingested rows (the 4B
// on the background engine) with the prompt clock at each session's
// own time. The question is then asked once through the full engine
// as a live turn (the pinned seed, the prompt clock at the question's
// own time) and scored by the dataset's own rule.
//
// Usage: bun run backend/scripts/bench/datasets/replay.ts --dataset
// longmemeval-oracle|longmemeval-oracle-v0|longmemeval-sample|locomo
// [--only id,id] [--seed N]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { startRecordingProxy } from "../recordingProxy";
import { loadLongMemEval } from "./longmemeval";
import { loadLocomo } from "./locomo";
import { absolutePath, registryEntry } from "./registry";
import { SAMPLE_SEED } from "./sample";
import { sessionToIngestRows, isLongMemEvalHouseholdMember, locomoHouseholdMemberSpeaker } from "./replayIngest";
import { scoreLocomo, longMemEvalTotalsByType, locomoTotalsByCategory, computeRecallHits, type LongMemEvalResult, type LocomoResult, type JudgeWrittenRecord, type RecallDiagnostics } from "./replayScore";
import type { DatasetConversation, DatasetSession, LongMemEvalQuestion, LocomoQuestion } from "./types";

const upstream = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!upstream) {
  console.error("replay setup refused: MAIPAI_LLAMA_SERVER_URL is not set; the replay connects only to an engine already running.");
  process.exit(2);
}
const proxy = startRecordingProxy(upstream);
process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;

const setup = await import("../setup");
const { startBench, finishBench } = setup;
const { runTurnStream } = await import("@/lib/turnEngine");
const { logTurn, createConversation, maybeRefreshConversationSummary } = await import("@/lib/conversationHistory");
const { classifyTurnSignal, fallbackSignal } = await import("@/lib/turnSignal");
const { judgeStatusAtInsert } = await import("@/lib/turnEngine");
const { runJudgeBatch } = await import("@/lib/memoryJudge");
const { evaluateSafety } = await import("@/lib/safety");
const { speakerAgeBand } = await import("@/lib/ageBand");
const { getBackgroundClient, probeBackgroundEngine, completeBackground } = await import("@/lib/backgroundSupervisor");
const { __setTurnActivityClockForTests } = await import("@/lib/turnActivity");
const { __setSamplingSeedForBench, __setPromptClockForBench } = await import("@/lib/benchSampling");
const { __resetEmbedSupervisorForTests } = await import("@/lib/embedSupervisor");
const { newPersonId, randomSuffix } = await import("@/lib/id");
const { nextHlc } = await import("@/lib/hlc");
const { sqlite, db } = await import("@/db");
const { people, conversations, conversationTurns, episodes, episodeEmbeddings, pendingEpisodeEmbeddings, memoryRecords, memoryEmbeddings, pendingEmbeddings, relationships, entities, notificationDeliveries } = await import("@/db/schema");
const { eq, or } = await import("drizzle-orm");

// ==== CLI ====

type DatasetName = "longmemeval-oracle" | "longmemeval-oracle-v0" | "longmemeval-sample" | "locomo";

function datasetFromArgv(argv: readonly string[]): DatasetName {
  const at = argv.indexOf("--dataset");
  const raw = at >= 0 ? argv[at + 1] : undefined;
  if (raw === "longmemeval-oracle" || raw === "longmemeval-oracle-v0" || raw === "longmemeval-sample" || raw === "locomo") return raw;
  console.error(`replay setup refused: --dataset wants longmemeval-oracle, longmemeval-oracle-v0, longmemeval-sample or locomo; got "${raw ?? ""}"`);
  process.exit(2);
}
function onlyFromArgv(argv: readonly string[]): Set<string> | null {
  const at = argv.indexOf("--only");
  if (at < 0) return null;
  const raw = argv[at + 1] ?? "";
  const ids = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  if (ids.size === 0) throw new Error("--only needs a comma-separated list of ids");
  return ids;
}
function seedFromArgv(argv: readonly string[]): number {
  const at = argv.indexOf("--seed");
  if (at < 0) return SAMPLE_SEED;
  return Number(argv[at + 1]);
}

const dataset = datasetFromArgv(process.argv);
const only = onlyFromArgv(process.argv);
const benchSeed = seedFromArgv(process.argv);
__setSamplingSeedForBench(benchSeed);

// ==== date parsing (each dataset's own format, kept in this file only -
// no other loader or bench needs a real Date from the raw string) ====

/** LongMemEval's own "2023/04/10 (Mon) 17:50" format. The weekday in
 * parens is redundant with the date and never parsed. */
function parseLongMemEvalDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]+\) (\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/** LoCoMo's own "1:00 pm on 8 May, 2023" format. */
function parseLocomoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ==== the seeded household member ====

/** One adult household member for the whole replay run (the dataset's
 * own "user" side), the same disposable-row shape createBenchPeople()
 * uses for the household bench - not reused from there directly since
 * that helper always creates its own fixed owner-and-child pair, one
 * person more than a memory replay needs. Returns only the id;
 * `personRow()` reads back the real row wherever the engine's own
 * functions need one. */
function createReplayPerson(): string {
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)").run(id, "Replay", "owner", randomSuffix(12), now, now, nextHlc());
  return id;
}

/** Wipes every table this run's own ingestion, the judge or subjects.ts
 * could have written, in the dependency order a foreign key needs
 * (children before the people row they reference) - a review found a
 * bare `DELETE FROM people` silently no-opping on the FK violation
 * every question after the first (SQLite runs with foreign_keys ON,
 * db/index.ts), leaving the prior question's household-scope memory
 * facts (no owning person, visible to any household member by design)
 * live for the next question's freshly-created person to recall,
 * contaminating the very per-question isolation the accuracy numbers
 * depend on. Never `resetDb()` (tests/reset-db.ts): that helper is
 * guarded to refuse outside a `bun test` disposable directory and is
 * explicitly not for a `bun run` script to call, even one (like this
 * one, through setup.ts) already proven to hold its own fresh,
 * temp-root-scoped, otherwise-empty MAIPAI_DATA_DIR. */
function resetReplayDatabase(): void {
  // memory.updated (lib/notifications.ts's trigger(), fired whenever the
  // judge writes a record) references the person as its own recipient -
  // a dry run found this exact FK the first time this function ran live
  // (`notification_deliveries.recipient_id`), silently caught and only
  // logged in that version, which is why the whole sequence below is
  // wrapped instead: a table this function still doesn't know about
  // needs to be loud, not a line buried in a 500-question run's own
  // console. A trailing "did any people rows survive?" check was tried
  // first and dropped: SQLite runs with foreign_keys ON (db/index.ts),
  // so an unfiltered `DELETE FROM people` with a still-live reference
  // elsewhere throws right there, on that statement - a check placed
  // after it can never run, since the delete itself always either
  // clears the table or throws first.
  try {
    db.delete(relationships).run();
    db.delete(entities).run();
    db.delete(memoryEmbeddings).run();
    db.delete(pendingEmbeddings).run();
    db.delete(memoryRecords).run();
    db.delete(episodeEmbeddings).run();
    db.delete(pendingEpisodeEmbeddings).run();
    db.delete(episodes).run();
    db.delete(notificationDeliveries).run();
    db.delete(conversationTurns).run();
    db.delete(conversations).run();
    db.delete(people).run();
  } catch (err) {
    throw new Error(`resetReplayDatabase left rows behind - some table not cleared above still references a people row (SQLite foreign_keys is ON); find it and add its delete before trusting per-question isolation again: ${(err as Error).message}`);
  }
}

async function personRow(id: string) {
  const row = db.select().from(people).where(eq(people.id, id)).get();
  if (!row) throw new Error(`replay person ${id} vanished mid-run`);
  return row;
}

/** The judge's own written records for this question's ingested history
 * so far (person-scoped plus household-scope, conversationRunner.ts's
 * own `recordsFor()` pattern mirrored here) - read after ingestion's
 * own drainJudge() and before resetReplayDatabase() wipes the table, so
 * a miss can be told apart from "never stored" versus "stored, not
 * retrieved". */
function judgeWrittenRecordsFor(actorId: string): JudgeWrittenRecord[] {
  return db
    .select({ text: memoryRecords.text, status: memoryRecords.status })
    .from(memoryRecords)
    .where(or(eq(memoryRecords.person, actorId), eq(memoryRecords.scope, "household")))
    .all()
    .filter((r) => r.text.length > 0);
}

/** The dataset's own evidence turns for one LongMemEval question: every
 * turn across the haystack conversation's sessions flagged
 * `isEvidence` (the dataset's own has_answer flag, never re-derived). */
function longMemEvalEvidenceTurns(conv: DatasetConversation): { turnId: string | null; text: string }[] {
  return conv.sessions.flatMap((s) => s.turns.filter((t) => t.isEvidence).map((t) => ({ turnId: t.turnId, text: t.text })));
}

/** The dataset's own evidence turns for one LoCoMo question, resolved
 * from its own `evidenceTurnIds` (dataset-native ids like "D1:3") back
 * to their text in the conversation that was actually ingested. An id
 * the conversation carries no matching turn for (should not happen)
 * keeps its id with empty text rather than being silently dropped. */
function locomoEvidenceTurns(conv: DatasetConversation, evidenceTurnIds: readonly string[]): { turnId: string | null; text: string }[] {
  const byId = new Map<string, string>();
  for (const session of conv.sessions) for (const t of session.turns) if (t.turnId) byId.set(t.turnId, t.text);
  return evidenceTurnIds.map((id) => ({ turnId: id, text: byId.get(id) ?? "" }));
}

// ==== ingestion ====

/** Logs one ingested row through the real turn store: the signal
 * classified the same way the engine classifies a live turn's, the
 * judge's own eligibility check applied at insert, never a chat
 * completion spent producing the reply text (it is the dataset's
 * own).
 *
 * `source: "model"` is the closest fit in TurnValue's own enum
 * (wire.ts, backend/src/, out of scope to extend here): every other
 * value either implies a package ran (`plugin`) or gets excluded from
 * the judge entirely (`policy`, `safety_refuse` - judgeStatusAtInsert's
 * own check), which would defeat this whole item's purpose. Accepted
 * side effect, not fixed here: episodes.ts's replyIsAnAnswer() and
 * every other `source` reader treat an ingested row exactly like a
 * real, live MaiPai reply, since nothing in the existing enum
 * distinguishes "replayed dataset text" from "the hub's own words."
 *
 * `evaluateSafety()` always stamps its own `checked_at` with the real
 * wall clock (spec/safety/ts/classifier.ts), and `logTurn()` takes the
 * persisted row's own `createdAt` from exactly that field - so setting
 * the bench's prompt clock before this call (ingestSession() does)
 * does NOT reach the stored timestamp on its own; a review found every
 * ingested row landing with today's date regardless. Overwritten here,
 * after the call, to the session's own historical instant - the one
 * field this function must get right, since memoryJudge.ts's own
 * extraction prompt is built from the turn's stored `createdAt`. */
async function ingestRow(actorId: string, conversationId: string, row: { userText: string; replyText: string }, at: Date): Promise<void> {
  const actor = await personRow(actorId);
  const ageBand = speakerAgeBand(actor, at);
  let signal;
  try {
    signal = classifyTurnSignal({ text: row.userText, ageBand });
  } catch (err) {
    console.error(`[replay] classifyTurnSignal failed on an ingested row, the fallback stands: ${(err as Error).message}`);
    signal = fallbackSignal(row.userText, ageBand);
  }
  const safety = evaluateSafety(row.userText, ageBand);
  safety.checked_at = at.toISOString();
  // The dataset's own reply-side text never passes through generation,
  // so it never meets the real output-safety gate a live reply would.
  // Not fully replicated here (that needs the guard/redaction pipeline
  // turnEngine.ts's own gateOutputSafety() runs, out of scope to pull
  // in for a research bench over already-published, human-curated
  // benchmark text) - loud instead, so a run that does hit one is
  // visible in the log rather than silently stored and made
  // recallable.
  if (row.replyText && evaluateSafety(row.replyText, ageBand).flagged) {
    console.error(`[replay] the dataset's own reply text for turn on conversation ${conversationId} would have been output-safety-flagged live; ingested unfiltered (no output-safety gate runs here)`);
  }
  const value = {
    reply: { text: row.replyText },
    source: "model" as const,
    safety,
    conversation_id: conversationId,
    turn_id: `replay-${crypto.randomUUID()}`,
  };
  logTurn(actor, "chat", row.userText, value, { signal, judgeStatus: judgeStatusAtInsert(value, signal) });
}

async function ingestSession(actorId: string, conversationId: string, session: DatasetSession, at: Date | null, isHouseholdMember: (t: DatasetSession["turns"][number]) => boolean): Promise<void> {
  if (at) __setPromptClockForBench(() => at);
  for (const row of sessionToIngestRows(session, isHouseholdMember)) {
    await ingestRow(actorId, conversationId, row, at ?? new Date());
  }
}

async function drainJudge(label: string): Promise<void> {
  __setTurnActivityClockForTests(() => Date.now() + 60_000);
  try {
    let exhausted = true;
    for (let i = 0; i < 20; i++) {
      const batch = await runJudgeBatch();
      if (batch.processed === 0) {
        exhausted = false;
        break;
      }
    }
    // resetReplayDatabase() between questions means no other question's
    // turns are in this queue, so hitting the cap here means THIS
    // question's own haystack genuinely has more judgeable turns than
    // the budget - loud rather than silently asking the question
    // against a partially-judged history.
    if (exhausted) console.error(`[replay] drainJudge for ${label} hit its own batch cap without emptying the queue - some ingested turns may be unjudged when the question is asked`);
  } finally {
    __setTurnActivityClockForTests(() => Date.now());
  }
}

// ==== asking the question as a live turn ====

async function askQuestion(actor: Awaited<ReturnType<typeof personRow>>, conversationId: string, question: string): Promise<string> {
  const result = await runTurnStream(actor, "chat", question, { conversationId });
  if (!result.ok) throw new Error(`replay: runTurnStream refused the question: ${result.error}`);
  if (result.kind === "immediate") return result.value.reply.text;
  let text = "";
  for await (const delta of result.tokens) text += delta;
  return text;
}

// ==== grading (LongMemEval) ====

const GRADER_SYSTEM = "You are grading whether a chat assistant's reply correctly answers a question, given the question's own reference answer. Reply with exactly one word: correct or incorrect. The assistant's reply does not need to match the reference answer's wording, only its meaning.";

async function gradeLongMemEvalReply(question: string, referenceAnswer: string, reply: string): Promise<"correct" | "incorrect"> {
  const result = await completeBackground([
    { role: "system", content: GRADER_SYSTEM },
    { role: "user", content: `Question: ${question}\nReference answer: ${referenceAnswer}\nAssistant's reply: ${reply}\n\nIs the assistant's reply correct?` },
  ]);
  if (!result.ok) throw new Error("replay: the grader (background engine) is unavailable");
  return /\bincorrect\b/i.test(result.text) ? "incorrect" : "correct";
}

// ==== per-dataset runs ====

async function runLongMemEval(questions: readonly LongMemEvalQuestion[], conversations: readonly DatasetConversation[]): Promise<LongMemEvalResult[]> {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const results: LongMemEvalResult[] = [];
  for (const q of questions) {
    const conv = byId.get(q.conversationId);
    if (!conv) throw new Error(`replay: no haystack conversation for question ${q.questionId}`);
    // Caught per question, not let out of the whole run: a review found
    // one bad question (a malformed date, a transient engine hiccup)
    // aborting main() before any earlier question's result was ever
    // written to disk. Scored incorrect with the error recorded, never
    // silently dropped from the totals. Cleanup's own try/catch/finally
    // is deliberately separate from this one: resetReplayDatabase() now
    // throws on an incomplete wipe (a dry run found it silently
    // swallowing one), and that must never masquerade as THIS
    // question's own answer failing - a success already pushed to
    // `results` stays pushed exactly once either way.
    try {
      const personId = createReplayPerson();
      try {
        const actor = await personRow(personId);
        const created = createConversation(actor, { surface: "chat" });
        if (!created.ok) throw new Error(`replay: createConversation failed: ${created.error}`);
        for (const session of conv.sessions) await ingestSession(personId, created.value.id, session, parseLongMemEvalDate(session.timestamp), isLongMemEvalHouseholdMember);
        // ACT-01's own real path debounces this post-turn (turnEngine.ts's
        // private scheduleSummaryRefresh(), unreachable from here); called
        // directly instead so buildConversationWindow() has a real summary
        // once a haystack runs past its own newest-turns-kept bound,
        // rather than a hard-truncated window with nothing older visible.
        await maybeRefreshConversationSummary(created.value.id);
        await drainJudge(q.questionId);
        const judgeWrittenRecords = judgeWrittenRecordsFor(personId);
        const askAt = parseLongMemEvalDate(q.questionDate);
        if (askAt) __setPromptClockForBench(() => askAt);
        proxy.reset();
        const reply = await askQuestion(actor, created.value.id, q.question);
        await proxy.settled();
        const contextMessage = proxy.requests.length ? proxy.requests.map((r) => r.systemText).join("\n") : null;
        const recallHits = computeRecallHits(longMemEvalEvidenceTurns(conv), contextMessage);
        const verdict = await gradeLongMemEvalReply(q.question, q.answer, reply);
        results.push({ questionId: q.questionId, questionType: q.questionType, isAbstention: q.isAbstention, reply, grader: "4b", verdict, contextMessage, recallHits, judgeWrittenRecords });
        console.log(`[replay-question] ${JSON.stringify({ questionId: q.questionId, type: q.questionType, isAbstention: q.isAbstention, verdict, reply, recallHits, judgeWrittenRecords: judgeWrittenRecords.map((r) => `${r.status}: ${r.text}`) })}`);
      } finally {
        __setPromptClockForBench(null);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[replay] question ${q.questionId} threw, scored incorrect: ${message}`);
      results.push({ questionId: q.questionId, questionType: q.questionType, isAbstention: q.isAbstention, reply: "", grader: "4b", verdict: "incorrect", error: message, contextMessage: null, recallHits: [], judgeWrittenRecords: [] });
    }
    try {
      resetReplayDatabase();
    } catch (err) {
      console.error(`[replay] resetReplayDatabase failed after question ${q.questionId}: ${(err as Error).message} - a later question's own isolation may be compromised`);
    }
  }
  return results;
}

async function runLocomo(conversations: readonly DatasetConversation[], questionsByConversation: Map<string, LocomoQuestion[]>): Promise<LocomoResult[]> {
  const results: LocomoResult[] = [];
  for (const conv of conversations) {
    const questions = questionsByConversation.get(conv.id) ?? [];
    if (questions.length === 0) continue;
    const householdSpeaker = locomoHouseholdMemberSpeaker(conv.sessions);
    if (!householdSpeaker) continue;
    const isHouseholdMember = (t: DatasetSession["turns"][number]) => t.speaker === householdSpeaker;
    // Cleanup's own try/catch sits outside this one, after it, for the
    // identical reason runLongMemEval() now keeps them apart:
    // resetReplayDatabase() throwing must never re-push (or discard)
    // a question this conversation's own inner loop already scored.
    try {
      const personId = createReplayPerson();
      try {
        const actor = await personRow(personId);
        const created = createConversation(actor, { surface: "chat" });
        if (!created.ok) throw new Error(`replay: createConversation failed: ${created.error}`);
        for (const session of conv.sessions) await ingestSession(personId, created.value.id, session, parseLocomoDate(session.timestamp), isHouseholdMember);
        await maybeRefreshConversationSummary(created.value.id);
        await drainJudge(conv.id);
        // Shared by every question over this conversation: they all
        // read the same ingested history, judged once above.
        const judgeWrittenRecords = judgeWrittenRecordsFor(personId);
        // Every question in this conversation shares the same ingested
        // history; caught per question so one bad question does not
        // lose the rest of this conversation's own results.
        for (const q of questions) {
          try {
            proxy.reset();
            const reply = await askQuestion(actor, created.value.id, q.question);
            await proxy.settled();
            const contextMessage = proxy.requests.length ? proxy.requests.map((r) => r.systemText).join("\n") : null;
            const recallHits = computeRecallHits(locomoEvidenceTurns(conv, q.evidenceTurnIds), contextMessage);
            const diagnostics: RecallDiagnostics = { contextMessage, recallHits, judgeWrittenRecords };
            const scored = scoreLocomo(conv.id, q.category, reply, q.answer, q.adversarialAnswer, diagnostics);
            results.push(scored);
            console.log(`[replay-question] ${JSON.stringify({ conversationId: conv.id, category: q.category, f1: scored.f1, refusedAdversarialPremise: scored.refusedAdversarialPremise, reply, recallHits, judgeWrittenRecords: judgeWrittenRecords.map((r) => `${r.status}: ${r.text}`) })}`);
          } catch (err) {
            const message = (err as Error).message;
            console.error(`[replay] ${conv.id} category ${q.category} question threw: ${message}`);
            // judgeWrittenRecords is still known here (ingestion and the
            // judge already ran; only this one question's own live turn
            // threw) - reused rather than reported empty, so this row
            // still reads "stored, the live turn errored" instead of
            // falsely reading "nothing was ever stored".
            results.push({ conversationId: conv.id, category: q.category, reply: "", answer: q.answer, adversarialAnswer: q.adversarialAnswer, f1: 0, refusedAdversarialPremise: null, error: message, contextMessage: null, recallHits: [], judgeWrittenRecords });
          }
        }
      } finally {
        __setPromptClockForBench(null);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[replay] ${conv.id} ingestion threw, its ${questions.length} question(s) skipped: ${message}`);
      for (const q of questions) results.push({ conversationId: conv.id, category: q.category, reply: "", answer: q.answer, adversarialAnswer: q.adversarialAnswer, f1: 0, refusedAdversarialPremise: null, error: message, contextMessage: null, recallHits: [], judgeWrittenRecords: [] });
    }
    try {
      resetReplayDatabase();
    } catch (err) {
      console.error(`[replay] resetReplayDatabase failed after conversation ${conv.id}: ${(err as Error).message} - a later conversation's own isolation may be compromised`);
    }
  }
  return results;
}

// ==== main ====

async function commitHash(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir, stdout: "pipe", stderr: "ignore" });
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "n/a";
  }
}

async function main() {
  await startBench();
  await getBackgroundClient();
  const judge = await probeBackgroundEngine();
  if (!judge.alive) {
    console.error(`replay setup refused: no memory judge answers at MAIPAI_BACKGROUND_URL (${process.env.MAIPAI_BACKGROUND_URL}); the replay needs the judge for ingestion.`);
    process.exit(2);
  }

  const registryDataset = dataset === "locomo" ? "locomo" : "longmemeval-cleaned";
  const entry = registryEntry(registryDataset);
  // Read once, reused below for the id filter too - a review caught this
  // and the filter block each independently reading and parsing the same
  // file, which risked the header's own seed and the filter's own
  // entries silently disagreeing if the two sites ever drifted apart.
  const oracleV0Manifest = dataset === "longmemeval-oracle-v0" ? (JSON.parse(readFileSync(join(import.meta.dir, "oracle-v0-manifest.json"), "utf-8")) as { seed: number; entries: { questionId: string }[] }) : null;
  // The sample manifest's own selection seed (which 30 ids got picked),
  // distinct from `benchSeed` above (the runtime model-sampling seed) -
  // surfaced in the header, not just left inside the committed manifest
  // file, so a reader of one run's own header can see both numbers a
  // rerun needs without going to find the file.
  const header = {
    commit: await commitHash(),
    date: new Date().toISOString(),
    seed: benchSeed,
    dataset: { name: entry.name, version: entry.version, checksums: entry.files },
    ...(oracleV0Manifest ? { sampleManifestSeed: oracleV0Manifest.seed } : {}),
    ...(only ? { partial: `--only ${[...only].join(",")}` } : {}),
  };
  console.log("\n## Run header\n\n```json");
  console.log(JSON.stringify(header, null, 2));
  console.log("```\n");

  const outDir = join(import.meta.dir, "..", "..", "..", "..", "data-scratch", "eval");
  mkdirSync(outDir, { recursive: true });

  let executed: number;
  if (dataset === "longmemeval-oracle" || dataset === "longmemeval-oracle-v0" || dataset === "longmemeval-sample") {
    const path = dataset === "longmemeval-sample" ? "longmemeval_s_cleaned.json" : "longmemeval_oracle.json";
    const raw = JSON.parse(readFileSync(absolutePath(path), "utf-8")) as unknown[];
    const { conversations, questions } = loadLongMemEval(raw);
    let selected = questions;
    if (dataset === "longmemeval-sample") {
      const manifestPath = join(import.meta.dir, "sample-manifest.json");
      const manifestIds = new Set((JSON.parse(readFileSync(manifestPath, "utf-8")) as { questionId: string }[]).map((e) => e.questionId));
      selected = questions.filter((q) => manifestIds.has(q.questionId));
    }
    // Baseline v0 (the coordinator, 2026-09-14): 5 per question type, 30
    // total, drawn deterministically from the oracle set itself
    // (generate-oracle-v0-manifest.ts) - the same manifest-filter shape
    // the S-set sample uses just above, over a different committed file.
    if (oracleV0Manifest) {
      const manifestIds = new Set(oracleV0Manifest.entries.map((e) => e.questionId));
      selected = questions.filter((q) => manifestIds.has(q.questionId));
    }
    if (only) selected = selected.filter((q) => only.has(q.questionId));
    const results = await runLongMemEval(selected, conversations);
    const totals = longMemEvalTotalsByType(results);
    console.log("\n## Totals by question type\n");
    for (const t of totals) console.log(`- ${t.type}: ${t.correct}/${t.n} (${(100 * t.accuracy).toFixed(1)}%)`);
    writeFileSync(join(outDir, `replay-${dataset}.json`), `${JSON.stringify({ header, results, totals }, null, 2)}\n`);
    executed = results.length;
  } else {
    const raw = JSON.parse(readFileSync(absolutePath("locomo10.json"), "utf-8")) as unknown[];
    const { conversations, questions } = loadLocomo(raw);
    const byConversation = new Map<string, LocomoQuestion[]>();
    for (const q of questions) {
      if (only && !only.has(q.conversationId)) continue;
      const bucket = byConversation.get(q.conversationId) ?? [];
      bucket.push(q);
      byConversation.set(q.conversationId, bucket);
    }
    const selectedConversations = only ? conversations.filter((c) => only.has(c.id)) : conversations;
    const results = await runLocomo(selectedConversations, byConversation);
    const totals = locomoTotalsByCategory(results);
    console.log("\n## Totals by category\n");
    for (const t of totals) console.log(`- category ${t.category}: n=${t.n}${t.meanF1 !== null ? `, mean F1=${t.meanF1.toFixed(3)}` : ""}${t.refusalRate !== null ? `, refusal rate ${(100 * t.refusalRate).toFixed(1)}%` : ""}`);
    writeFileSync(join(outDir, "replay-locomo.json"), `${JSON.stringify({ header, results, totals }, null, 2)}\n`);
    executed = results.length;
  }

  __resetEmbedSupervisorForTests();
  return { executed };
}

let summary: Awaited<ReturnType<typeof main>> = { executed: 0 };
try {
  summary = await main();
} finally {
  proxy.stop();
}
finishBench(summary);
