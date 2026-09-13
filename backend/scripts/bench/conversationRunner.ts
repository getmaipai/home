// The baseline conversation bench's runner: drives one fixture
// conversation through the real `runTurnStream()` and reads every
// outcome from the system's own state afterwards (the turn row, the
// memory rows written with the turn as source, the `[turn]` and
// `[route]` log lines, the context message the model saw through the
// recording proxy, the lease registry). No engine setup here: the live
// entry point (conversationLive.ts) imports setup.ts first and passes
// the judge and the backdating in; tests/conversationBench.test.ts
// drives the same functions against the stub, so the control flow
// (abort, confirmation, credential, cross-person, scoring) is proven
// offline before a live run.
import { eq, and, or, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns, memoryRecords, people, lists, entities, relationships } from "@/db/schema";
import { runTurnStream, type TurnStreamResult } from "@/lib/turnEngine";
import { createConversation, getPendingAsk } from "@/lib/conversationHistory";
import { activeTurnCount } from "@/lib/turnActivity";
import { remember } from "@/lib/memory";
import { deleteEpisodesForPerson } from "@/lib/episodes";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createEntity } from "@/lib/entities";
import { createRelationship } from "@/lib/relationships";
import { listJobs, runDueJobs } from "@/lib/scheduler";
import { runPlugin, registerAllPackageNotificationTypes } from "@/lib/plugins";
import { listPending } from "@/lib/notifications";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import type { BenchConversation, Speaker } from "./conversationFixture";
import { scoreTurn, type TurnObserved, type TurnScore } from "./conversationScore";

// ==== The [turn] / [route] log capture ====

interface TurnLine {
  turn_id: string;
  guard?: string[];
  plugin_id?: string;
  source?: string;
  safety_action?: string;
  /** The subject tracker's resolved subject, once one writes it (CHAT-13). */
  subject?: string;
}
interface RouteLine {
  turn_id: string;
  offered?: string[];
  winner?: string | null;
  tier?: string;
}

export interface LogCapture {
  turns: Map<string, TurnLine>;
  routes: Map<string, RouteLine>;
  stop(): void;
}

/** Wraps console.log for the run: the engine's own `[turn]` and
 * `[route]` lines are parsed by turn id and still printed. */
export function captureTurnLog(): LogCapture {
  const turns = new Map<string, TurnLine>();
  const routes = new Map<string, RouteLine>();
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      try {
        if (first.startsWith("[turn] {")) {
          const line = JSON.parse(first.slice(7)) as TurnLine;
          turns.set(line.turn_id, line);
        } else if (first.startsWith("[route] {")) {
          const line = JSON.parse(first.slice(8)) as RouteLine;
          routes.set(line.turn_id, line);
        }
      } catch {
        // not one of ours
      }
    }
    original(...args);
  };
  return { turns, routes, stop: () => void (console.log = original) };
}

// The recording proxy lives in recordingProxy.ts (no database import,
// so conversationLive.ts can start it before setup.ts runs).
import { type RecordingProxy } from "./recordingProxy";
export { startRecordingProxy, type RecordingProxy, type RecordedRequest } from "./recordingProxy";

// ==== People and conversations ====

export interface BenchPeople {
  owner: PersonRow;
  child: PersonRow;
}

/** The bench's own two people, inserted the way the memory bench does. */
export function createBenchPeople(): BenchPeople {
  const nowIso = new Date().toISOString();
  const insert = (displayName: string, role: string): PersonRow => {
    const id = newPersonId();
    sqlite
      .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)")
      .run(id, displayName, role, randomSuffix(12), nowIso, nowIso, nextHlc());
    const row = db.select().from(people).where(eq(people.id, id)).get();
    if (!row) throw new Error(`failed to create the bench person ${displayName}`);
    return row;
  };
  return { owner: insert("Sage", "owner"), child: insert("Bramble", "child") };
}

// ==== The fake Home Assistant (E2, A4) ====

export interface FakeHomeAssistant {
  url: string;
  /** Calls received, by "domain.service". */
  calls: Record<string, number>;
  stop(): void;
}

/** A Bun.serve() on port 0 that answers Home Assistant's service-call
 * endpoint and counts each call: the package's own effect, counted
 * where it lands, never inferred from turn rows. Points the household's
 * `home.base_url` and `home.access_token` at itself (the bench's
 * disposable database). */
export function startFakeHomeAssistant(): FakeHomeAssistant {
  const calls: Record<string, number> = {};
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const m = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(new URL(req.url).pathname);
      if (req.method === "POST" && m) {
        const key = `${decodeURIComponent(m[1]!)}.${decodeURIComponent(m[2]!)}`;
        calls[key] = (calls[key] ?? 0) + 1;
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  for (const [key, value] of [
    ["home.base_url", url],
    ["home.access_token", "bench-token"],
  ] as const) {
    const set = setHouseholdSettingValue(key, value);
    if (!set.ok) throw new Error(`the fake Home Assistant could not set ${key}: ${set.error}`);
  }
  return { url, calls, stop: () => server.stop(true) };
}

export interface RunDeps {
  people: BenchPeople;
  /** The recording proxy, when the run has one (the live run does; the
   * stub tests capture the context another way and pass null). */
  proxy: RecordingProxy | null;
  log: LogCapture;
  /** Run the memory judge until the queue is empty. */
  drainJudge: () => Promise<void>;
  /** Backdate everything the bench wrote for these people, and the
   * memory rows written from these turns, by N days. */
  backdate: (days: number, turnIds: readonly string[]) => void;
  /** The fake Home Assistant counting the lock package's own calls. */
  homeAssistant: FakeHomeAssistant | null;
  /** Fire the due scheduled jobs, as the hub's own minute tick does;
   * the default runs the real scheduler with the real package runner. */
  tickScheduler?: (now: Date) => Promise<void>;
}

// The hub registers every package's notification types at boot
// (index.ts); the bench runs turns in process and a fired timer's
// `timer.done` is declared by the timer package, so the same
// registration runs once here before the first tick (idempotent).
let notificationTypesRegistered = false;
const defaultTick = async (now: Date) => {
  if (!notificationTypesRegistered) {
    registerAllPackageNotificationTypes();
    notificationTypesRegistered = true;
  }
  await runDueJobs(runPlugin, now);
};

const SENTENCE_END = /[.!?]["')\]]?(\s|$)/;

interface Timings {
  firstDeltaMs: number | null;
  firstSentenceMs: number | null;
  totalMs: number;
}

/** Drives one turn: starts the stream, reads it (aborting after the
 * first delta for an interruption), finalizes, and returns the value
 * with the timings the bench measures itself. */
async function driveTurn(
  actor: PersonRow,
  say: string,
  opts: { conversationId: string; supersedes?: string; interrupt?: boolean },
): Promise<{ value: TurnValue | null; text: string; timings: Timings; error: string | null; interrupted: boolean }> {
  const t0 = performance.now();
  const controller = new AbortController();
  const elapsed = () => performance.now() - t0;
  let result: TurnStreamResult;
  try {
    result = await runTurnStream(actor, "chat", say, { conversationId: opts.conversationId, supersedes: opts.supersedes, signal: controller.signal });
  } catch (err) {
    return { value: null, text: "", timings: { firstDeltaMs: null, firstSentenceMs: null, totalMs: elapsed() }, error: (err as Error).message, interrupted: false };
  }
  if (!result.ok) return { value: null, text: "", timings: { firstDeltaMs: null, firstSentenceMs: null, totalMs: elapsed() }, error: result.error, interrupted: false };
  if (result.kind === "immediate") {
    const total = elapsed();
    return { value: result.value, text: result.value.reply.text, timings: { firstDeltaMs: total, firstSentenceMs: total, totalMs: total }, error: null, interrupted: false };
  }
  let text = "";
  let firstDeltaMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let outcome: unknown;
  let interrupted = false;
  try {
    const iterator = result.tokens[Symbol.asyncIterator]();
    let step = await iterator.next();
    while (!step.done) {
      text += step.value;
      if (firstDeltaMs === null && step.value.trim()) firstDeltaMs = elapsed();
      if (firstSentenceMs === null && SENTENCE_END.test(text)) firstSentenceMs = elapsed();
      if (opts.interrupt && firstDeltaMs !== null) {
        // The route's disconnect: the abort fires while the next read
        // is pending (the consumer is always waiting on the next token),
        // so the throw passes holdLease()'s finally and releases.
        interrupted = true;
        const pending = iterator.next();
        controller.abort();
        await pending;
        await iterator.return?.(undefined as never);
        break;
      }
      step = await iterator.next();
    }
    if (step.done) outcome = step.value;
  } catch (err) {
    if (!interrupted) return { value: null, text, timings: { firstDeltaMs, firstSentenceMs, totalMs: elapsed() }, error: (err as Error).message, interrupted };
  }
  if (interrupted) {
    // The route's disconnect path: nothing is finalized for a reply
    // nobody read; the lease releases through holdLease()'s finally.
    return { value: null, text, timings: { firstDeltaMs, firstSentenceMs, totalMs: elapsed() }, error: null, interrupted };
  }
  const resolved = outcome && typeof outcome === "object" && "resolved" in outcome ? (outcome as { resolved: TurnValue }).resolved : null;
  const value = result.finalize(text, outcome as Parameters<typeof result.finalize>[1]);
  const finalValue = resolved ?? value;
  return { value: finalValue, text: finalValue.reply.text, timings: { firstDeltaMs: firstDeltaMs ?? elapsed(), firstSentenceMs: firstSentenceMs ?? elapsed(), totalMs: elapsed() }, error: null, interrupted };
}

function memoryRowsFor(turnId: string | null): string[] {
  if (!turnId) return [];
  return db
    .select({ text: memoryRecords.text })
    .from(memoryRecords)
    .where(eq(memoryRecords.source, turnId))
    .all()
    .map((r) => r.text);
}

/** Package runs in the conversation so far: a turn row whose package
 * answered or failed while running; a confirmation ask (source
 * "confirm") parked the call and is not a run. */
function attemptsIn(conversationId: string): Record<string, number> {
  const rows = db.select({ pluginId: conversationTurns.pluginId, source: conversationTurns.source }).from(conversationTurns).where(eq(conversationTurns.conversationId, conversationId)).all();
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.pluginId || (r.source !== "plugin" && r.source !== "plugin_error")) continue;
    for (const id of r.pluginId.split("+")) counts[id] = (counts[id] ?? 0) + 1; // a two-call turn stores "a+b"
  }
  return counts;
}

/** The person's and the household's memory records with their status
 * (A3: a correction retires the old record and activates the new one). */
function recordsFor(actor: PersonRow): { text: string; status: string }[] {
  return db
    .select({ text: memoryRecords.text, status: memoryRecords.status })
    .from(memoryRecords)
    .where(or(eq(memoryRecords.person, actor.id), eq(memoryRecords.scope, "household")))
    .all()
    .filter((r) => r.text.length > 0);
}

/** Every open item on the household's lists by id (A5, the list-add
 * effect; a checked-off item counts as gone, so G3's "take it off"
 * passes whether the path removes or completes the item). */
function listItemsNow(): Map<string, string> {
  return new Map(
    db
      .select({ items: lists.items })
      .from(lists)
      .where(isNull(lists.deletedAt))
      .all()
      .flatMap((r) => (JSON.parse(r.items) as { id: string; text: string; done?: boolean }[]).filter((i) => !i.done).map((i) => [i.id, i.text] as const)),
  );
}

/** What a map gained since an earlier reading: a row reads only the
 * effects since its own start, never an earlier conversation's (a
 * review: the second lock conversation read the first one's call, and
 * a ten-minute timer from one conversation would satisfy the next). */
function since<T>(before: ReadonlyMap<string, T>, now: ReadonlyMap<string, T>): T[] {
  return [...now.entries()].filter(([id]) => !before.has(id)).map(([, v]) => v);
}

/** Seeds a conversation's entities in the household registry (B4),
 * with a relationship from the owner's own entity when asked; the
 * owner's entity is created once per run. */
const seededEntityIds = new Set<string>();
function seedEntities(conv: BenchConversation, owner: PersonRow): void {
  if (!conv.seedEntities?.length) return;
  for (const e of conv.seedEntities) {
    const created = createEntity(owner, { kind: e.kind, name: e.name, aliases: [...(e.aliases ?? [])], description: e.description, scope: "household" });
    if (!created.ok || !created.value) throw new Error(`seeding entity ${e.name} for ${conv.id}: ${created.ok ? "no value" : created.error}`);
    seededEntityIds.add(created.value.id);
    if (e.relationshipFromOwner) {
      let self = db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, owner.id), isNull(entities.deletedAt))).get();
      if (!self) {
        const made = createEntity(owner, { kind: "person", name: owner.displayName, account_person_id: owner.id, scope: "household" });
        if (!made.ok || !made.value) throw new Error(`seeding the owner's entity for ${conv.id}: ${made.ok ? "no value" : made.error}`);
        self = { id: made.value.id };
        seededEntityIds.add(self.id);
      }
      const rel = createRelationship(owner, { type: e.relationshipFromOwner, from_id: self.id, to_id: created.value.id, scope: "household" });
      if (!rel.ok) throw new Error(`seeding the relationship ${e.relationshipFromOwner} for ${conv.id}: ${rel.error}`);
    }
  }
}

/** Waits for the due time, ticks the scheduler the way the hub does
 * every minute, and returns the notification types delivered to the
 * person since the turn started (F2: the scheduler's own later
 * delivery, observed; an earlier conversation's timer firing in the
 * same tick does not count). Polls every half second up to
 * `withinMs`, so a job due in five seconds is seen in about five. */
async function observeDelivery(actor: PersonRow, notification: string, withinMs: number, tick: (now: Date) => Promise<void>, before: ReadonlySet<string>): Promise<string[]> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    await tick(new Date());
    const delivered = listPending(actor)
      .filter((n) => !before.has(n.id))
      .map((n) => n.typeId);
    if (delivered.includes(notification) || Date.now() >= deadline) return delivered;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const jobsNow = (actor: PersonRow) => new Map(listJobs(actor).map((j) => [j.id, { job: j.job, status: j.status }] as const));

export interface ConversationRun {
  scores: TurnScore[];
  /** The turn ids in order, for the caller's own cleanup or backdating. */
  turnIds: string[];
}

/** Runs one fixture conversation end to end and scores every turn. */
export async function runConversation(conv: BenchConversation, deps: RunDeps): Promise<ConversationRun> {
  const scores: TurnScore[] = [];
  const turnIds: string[] = [];
  const conversationIds: Partial<Record<Speaker, string>> = {};
  if (conv.seedPrivateForChild) {
    const seeded = remember(deps.people.child, { text: conv.seedPrivateForChild, category: "fact", tier: "durable", scope: "person", person: deps.people.child.id, source: `bench:${conv.id}`, importance: 0.8 });
    if (!seeded.ok) throw new Error(`seeding ${conv.id}: ${seeded.error}`);
  }
  seedEntities(conv, deps.people.owner);
  // Every conversation starts with empty lists: the household's one
  // shopping list is shared, and the live run found "the second one"
  // pointing at an item a conversation twenty rows earlier had added.
  // The household's lists and the bench people's own, never another
  // person's (the bench's database is disposable, setup.ts refuses any
  // other, and this keeps that promise inside the function too).
  sqlite.query("DELETE FROM lists WHERE scope = 'household' OR person IN (?, ?)").run(deps.people.owner.id, deps.people.child.id);
  const tick = deps.tickScheduler ?? defaultTick;
  // The fake Home Assistant counts for the whole run; a row reads the
  // calls this conversation made (the live run found the second lock
  // conversation reading the first one's call).
  const homeCallsAtStart = { ...(deps.homeAssistant?.calls ?? {}) };
  const listItemsAtStart = listItemsNow();
  const homeCallsSince = (): Record<string, number> => {
    const now = deps.homeAssistant?.calls ?? {};
    const delta: Record<string, number> = {};
    for (const [service, count] of Object.entries(now)) delta[service] = count - (homeCallsAtStart[service] ?? 0);
    return delta;
  };
  for (let i = 0; i < conv.turns.length; i++) {
    const turn = conv.turns[i]!;
    const speaker: Speaker = turn.as ?? "owner";
    const actor = deps.people[speaker];
    // The judge first, so the rows it writes are the ones backdated.
    if (turn.drainJudge) await deps.drainJudge();
    if (turn.daysLater) deps.backdate(turn.daysLater, turnIds.filter(Boolean));
    if (i === 0 || turn.newConversation || !conversationIds[speaker]) {
      const created = createConversation(actor, { surface: "chat" });
      if (!created.ok) throw new Error(`createConversation: ${created.error}`);
      conversationIds[speaker] = created.value.id;
    }
    const conversationId = conversationIds[speaker]!;
    const supersedes = turn.supersedesTurn !== undefined ? turnIds[turn.supersedesTurn] : undefined;
    deps.proxy?.reset();
    const before = new Set(deps.log.turns.keys());
    const beforeRoutes = new Set(deps.log.routes.keys());
    const jobsBefore = jobsNow(actor);
    const deliveriesBefore = new Set(listPending(actor).map((n) => n.id));
    const driven = await driveTurn(actor, turn.say, { conversationId, supersedes, interrupt: turn.interrupt });
    await deps.proxy?.settled(); // the teed reply text lands a tick after the client's read
    // An interrupted turn logs no [turn] line today (nothing is
    // finalized for a reply nobody read); its id is on the [route] line.
    const turnId = driven.value?.turn_id ?? [...deps.log.turns.keys()].find((id) => !before.has(id)) ?? [...deps.log.routes.keys()].find((id) => !beforeRoutes.has(id)) ?? null;
    if (turnId) turnIds[i] = turnId;
    const line = turnId ? deps.log.turns.get(turnId) : undefined;
    const route = turnId ? deps.log.routes.get(turnId) : undefined;
    const row = turnId ? db.select().from(conversationTurns).where(and(eq(conversationTurns.id, turnId), eq(conversationTurns.personId, actor.id))).get() : undefined;
    const requests = deps.proxy?.requests ?? [];
    // A row that reads memory (written, or nothing written) is read
    // after the judge has had its turn, so the judge's own rows count.
    if (turn.expect.memoryWritten || turn.expect.storesNothing || turn.expect.recordActive || turn.expect.recordRetired) await deps.drainJudge();
    // The jobs this turn scheduled, read before the delivery wait: a
    // promise row sees its own job pending, then the scheduler's own
    // delivery of it.
    const jobs = since(jobsBefore, jobsNow(actor));
    const deliveries = turn.expect.delivered ? await observeDelivery(actor, turn.expect.delivered.notification, turn.expect.delivered.withinMs, tick, deliveriesBefore) : [];
    // The turn's own completions: the interrupted one is the first
    // (a summary refresh may follow it on the same proxy).
    const own = requests[0];
    const observed: TurnObserved = {
      reply: driven.value?.reply.text ?? driven.text,
      source: driven.value?.source ?? row?.source ?? null,
      pluginId: driven.value?.plugin_id ?? row?.pluginId ?? null,
      guardHits: line?.guard ?? [],
      guardReplaced: row?.guardReason ?? null,
      safetyAction: driven.value?.safety.action ?? row?.safetyAction ?? null,
      crisisResources: Boolean(driven.value?.crisis_resources),
      memoryRows: memoryRowsFor(turnId),
      storedUserText: row?.userText ?? null,
      contextMessage: requests.length ? requests.map((r) => r.systemText).join("\n") : null,
      offeredTools: requests[0]?.tools ?? route?.offered ?? [],
      attempts: attemptsIn(conversationId),
      answered: driven.value !== null && driven.error === null,
      leaseCount: activeTurnCount(),
      firstDeltaMs: driven.timings.firstDeltaMs,
      firstSentenceMs: driven.timings.firstSentenceMs,
      totalMs: driven.timings.totalMs,
      interrupted: driven.interrupted,
      rawModelText: requests.length ? (requests[requests.length - 1]?.responseText ?? null) : null,
      records: recordsFor(actor),
      pendingAsk: getPendingAsk(conversationId)?.kind ?? null,
      listItems: since(listItemsAtStart, listItemsNow()),
      jobs,
      homeCalls: homeCallsSince(),
      sourceUrls: requests.flatMap((r) => r.sourceUrls),
      inferenceStopped: own ? own.aborted && !own.completed : null,
      reconciledRow: row !== undefined && row.replyText.trim().length > 0,
      deliveries,
      subject: line?.subject ?? null,
      entities: db
        .select({ kind: entities.kind, name: entities.name })
        .from(entities)
        .where(isNull(entities.deletedAt))
        .all(),
    };
    if (driven.error) observed.reply = `[error: ${driven.error}]`;
    scores.push(scoreTurn(conv, i, turn, observed));
  }
  return { scores, turnIds };
}

/** Deletes everything the bench wrote for its two people, inside its
 * own disposable database. Best effort: a row the bench did not expect
 * (a package's own table, the way list-add's lists row was on the first
 * live run) is reported, never allowed to lose the run's table, which
 * the caller prints before this runs. */
export function cleanupBenchPeople(peopleRows: BenchPeople): void {
  try {
    cleanupBenchPeopleStrict(peopleRows);
  } catch (err) {
    console.error(`[bench] cleanup left rows behind in the disposable database: ${(err as Error).message}`);
  }
}

function cleanupBenchPeopleStrict(peopleRows: BenchPeople): void {
  // The registry rows the household-subject conversations seeded (B4),
  // before the people they reference.
  for (const id of seededEntityIds) {
    sqlite.query("DELETE FROM relationships WHERE from_id = ? OR to_id = ?").run(id, id);
    sqlite.query("DELETE FROM entities WHERE id = ?").run(id);
  }
  seededEntityIds.clear();
  for (const person of [peopleRows.owner, peopleRows.child]) {
    sqlite.query("DELETE FROM lists WHERE person = ?").run(person.id); // list-add's own rows
    sqlite.query("DELETE FROM notification_deliveries WHERE recipient_id = ?").run(person.id);
    sqlite.query("DELETE FROM scheduled_jobs WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(person.id);
    deleteEpisodesForPerson(person.id); // the episode store's own FK-ordered delete
    sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM people WHERE id = ?").run(person.id);
  }
}

/** Backdates the rows the bench wrote for its people by N days: the
 * turn rows, the conversations, the memory records (the person's, and
 * the household-scope ones written from the bench's own turns) and the
 * episodes, computed in JS so the ISO format of created_at is
 * preserved. */
export function backdateBenchRows(peopleRows: BenchPeople, days: number, turnIds: readonly string[] = []): void {
  const shift = days * 86_400_000;
  const back = (iso: string) => new Date(new Date(iso).getTime() - shift).toISOString();
  for (const turnId of turnIds) {
    for (const column of ["created_at", "valid_from"] as const) {
      const rows = sqlite.query(`SELECT id, ${column} AS v FROM memory_records WHERE source = ? AND ${column} IS NOT NULL`).all(turnId) as { id: string; v: string }[];
      const update = sqlite.query(`UPDATE memory_records SET ${column} = ? WHERE id = ?`);
      for (const r of rows) update.run(back(r.v), r.id);
    }
  }
  for (const person of [peopleRows.owner, peopleRows.child]) {
    for (const [table, owner, column] of [
      ["conversation_turns", "person_id", "created_at"],
      ["conversations", "person_id", "created_at"],
      ["conversations", "person_id", "updated_at"],
      ["memory_records", "person", "created_at"],
      ["memory_records", "person", "valid_from"],
      ["episodes", "person_id", "created_at"],
    ] as const) {
      const rows = sqlite.query(`SELECT id, ${column} AS v FROM ${table} WHERE ${owner} = ? AND ${column} IS NOT NULL`).all(person.id) as { id: string; v: string }[];
      const update = sqlite.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
      for (const r of rows) update.run(back(r.v), r.id);
    }
  }
}
