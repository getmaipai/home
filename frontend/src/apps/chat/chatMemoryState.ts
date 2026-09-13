import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

// CHAT-20 (BACKLOG.md): real turn ids, memory ids, and memory status flow
// into both live and loaded assistant messages, and the chip plus the
// memory actions read ONE source of truth - this store, keyed by turn id.
// Replaces getmaipai/home#64's narrower path (chatMemoryChip.tsx polling
// NotificationBell.tsx's own `memory.updated` deliveries): that path only
// ever produced the "saved" state for a live reply, with no pending/
// not_saved/failed distinction and no per-message forget wiring - the
// real remaining scope this closes, per docs/BACKLOG.md's own note under
// CHAT-08's heading. NotificationBell.tsx itself is untouched (still the
// right place for a generic toast on any notification type).

export type MemoryStatus = "pending" | "saved" | "not_saved" | "failed";

/** A turn's `judge_status` (backend/src/db/schema.ts: null = "not judged
 * yet", "done"/"failed" terminal) only ever gets set at all for a
 * `source: "model"` turn - `memoryJudge.ts`'s own queue query excludes
 * every other source, so a plugin/command/safety-refusal turn stays
 * `judge_status: null` forever, not "still pending." A non-null
 * `memory_ids` always wins regardless of source or judge status: a
 * manual "Remember this" (chatMemoryActions.ts) writes into the exact
 * same `memory_records.source = turn_id` provenance field the automated
 * judge does, so a plugin-sourced turn a person explicitly saved is
 * "saved," not "not_saved." */
export function deriveMemoryStatus(row: { source: string; judgeStatus: string | null | undefined; memoryIds: readonly string[] }): MemoryStatus {
  if (row.memoryIds.length > 0) return "saved";
  if (row.judgeStatus === "failed") return "failed";
  if (row.judgeStatus === "done") return "not_saved";
  if (row.source !== "model") return "not_saved"; // never queued for judging at all
  return "pending";
}

interface MemoryStateEntry {
  conversationId: string;
  memoryIds: string[];
  status: MemoryStatus;
  /** Wall-clock ms when this turn was first observed pending - the 10
   * minute stall window (below) is real elapsed time, not "how long the
   * tab has been open and polling," so this is set once and kept across
   * poll ticks, not refreshed each time. */
  pendingSince?: number;
  /** Ten minutes pending with no resolution: BACKLOG.md's own "stop
   * polling and display 'Still waiting to process memory' ... do not
   * falsely mark failed" - a client-side timeout state, not a fifth wire
   * status, cleared by `refreshTurnMemoryStatus`'s manual re-check. */
  stalled: boolean;
}

interface MemoryStateStore {
  byTurnId: Record<string, MemoryStateEntry>;
}

const useMemoryStore = create<MemoryStateStore>(() => ({ byTurnId: {} }));

interface TurnRowLike {
  conversationId: string;
  source: string;
  judgeStatus: string | null | undefined;
  memoryIds: readonly string[];
}

/** Authoritative update from the server (a poll tick, a reload, a fresh
 * live turn) - always trusted over whatever the store already had,
 * except `pendingSince`/`stalled`, which only reset when the status
 * itself changes (see the field's own comment). */
function applyTurnRow(turnId: string, row: TurnRowLike): void {
  const status = deriveMemoryStatus(row);
  useMemoryStore.setState((s) => {
    const prev = s.byTurnId[turnId];
    const stillPending = status === "pending";
    const wasPendingUnstalled = prev?.status === "pending" && !prev.stalled;
    return {
      byTurnId: {
        ...s.byTurnId,
        [turnId]: {
          conversationId: row.conversationId,
          memoryIds: [...row.memoryIds],
          status,
          pendingSince: stillPending ? (wasPendingUnstalled ? prev!.pendingSince : Date.now()) : undefined,
          stalled: false,
        },
      },
    };
  });
}

/** Seeds an entry the first time a message mounts - a loaded row already
 * carries real `source`/`judgeStatus`/`memoryIds`; a live reply that just
 * finished streaming has none of the judge fields yet (the judge runs
 * after the turn, never during it), which `deriveMemoryStatus` reads the
 * same as a freshly-created, unjudged row. Never overwrites an existing
 * entry - a later poll or action is always more current than a mount-time
 * seed, and re-seeding on every render would stamp a fresh `pendingSince`
 * each time. */
function seedTurn(turnId: string, row: TurnRowLike): void {
  if (useMemoryStore.getState().byTurnId[turnId]) return;
  applyTurnRow(turnId, row);
}

/** Read by the chip and by the remember/forget actions - the one place
 * either looks for a turn's current memory state. */
export function useMemoryState(turnId: string | undefined, seed?: TurnRowLike): MemoryStateEntry | undefined {
  useEffect(() => {
    if (turnId && seed) seedTurn(turnId, seed);
    // Only the identity of the turn should re-seed; `seed`'s own fields
    // are a snapshot taken once at mount (a loaded row) or once a live
    // reply finishes (chatModelAdapter.ts) - re-running this on every
    // `seed` object identity change (a new object literal each render)
    // would fight the "never overwrite" rule above for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId]);
  return useMemoryStore((s) => (turnId ? s.byTurnId[turnId] : undefined));
}

/** "Remember this" (chatMemoryActions.ts) succeeded - the new id is real,
 * appended to whatever this turn already had (a judge-produced id and a
 * manual one can coexist). */
export function addMemoryId(turnId: string, conversationId: string, memoryId: string): void {
  useMemoryStore.setState((s) => {
    const prev = s.byTurnId[turnId];
    const memoryIds = prev ? [...prev.memoryIds, memoryId] : [memoryId];
    return { byTurnId: { ...s.byTurnId, [turnId]: { conversationId, memoryIds, status: "saved", pendingSince: undefined, stalled: false } } };
  });
}

/** "Forget this" archived every memory id this turn had. */
export function clearMemoryIds(turnId: string): void {
  useMemoryStore.setState((s) => {
    const prev = s.byTurnId[turnId];
    if (!prev) return s;
    return { byTurnId: { ...s.byTurnId, [turnId]: { ...prev, memoryIds: [], status: "not_saved", pendingSince: undefined, stalled: false } } };
  });
}

const STALL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

function markStalled(turnId: string): void {
  useMemoryStore.setState((s) => {
    const prev = s.byTurnId[turnId];
    if (!prev || prev.status !== "pending" || prev.stalled) return s;
    return { byTurnId: { ...s.byTurnId, [turnId]: { ...prev, stalled: true } } };
  });
}

function pendingUnstalledTurnIds(conversationId: string): string[] {
  return Object.entries(useMemoryStore.getState().byTurnId)
    .filter(([, e]) => e.conversationId === conversationId && e.status === "pending" && !e.stalled)
    .map(([turnId]) => turnId);
}

async function pollOnce(conversationId: string): Promise<void> {
  const now = Date.now();
  for (const turnId of pendingUnstalledTurnIds(conversationId)) {
    const entry = useMemoryStore.getState().byTurnId[turnId];
    if (entry?.pendingSince !== undefined && now - entry.pendingSince > STALL_MS) markStalled(turnId);
  }
  if (pendingUnstalledTurnIds(conversationId).length === 0) return;
  const rows = await api.conversationTurns(conversationId);
  for (const row of rows) applyTurnRow(row.id, { conversationId, source: row.source, judgeStatus: row.judgeStatus, memoryIds: row.memory_ids });
}

/** A manual "Refresh" click on a stalled chip - one re-check, and
 * (BACKLOG.md: "do not falsely mark failed") a turn that comes back
 * still pending gets a fresh, un-stalled window rather than staying
 * stuck. */
export async function refreshTurnMemoryStatus(conversationId: string, turnId: string): Promise<void> {
  const rows = await api.conversationTurns(conversationId);
  const row = rows.find((r) => r.id === turnId);
  if (row) applyTurnRow(turnId, { conversationId, source: row.source, judgeStatus: row.judgeStatus, memoryIds: row.memory_ids });
}

/** Polls the open conversation's own per-conversation turns endpoint
 * every 5s, only while something in it is genuinely pending (BACKLOG.md:
 * "poll ... only while the visible thread has pending memory
 * processing"). Paused while the browser tab is hidden, resumed when it
 * becomes visible again; stops entirely (effect cleanup) the moment
 * nothing pending remains or the conversation changes/unmounts - "no
 * poll remains when all statuses settle." One call, at the chat page's
 * own top level, not per message. */
export function useMemoryStatusPoll(conversationId: string | undefined): void {
  const hasPending = useMemoryStore((s) =>
    conversationId !== undefined && Object.values(s.byTurnId).some((e) => e.conversationId === conversationId && e.status === "pending" && !e.stalled),
  );

  useEffect(() => {
    if (!conversationId || !hasPending) return;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    function stop() {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    }

    async function tick() {
      if (stopped) return;
      await pollOnce(conversationId!).catch(() => {
        // A transient network error costs one missed tick, not the whole
        // poll - the next one, five seconds later, tries again.
      });
      if (!stopped && pendingUnstalledTurnIds(conversationId!).length === 0) stop();
    }

    function start() {
      if (intervalId !== undefined || document.visibilityState !== "visible") return;
      void tick();
      intervalId = setInterval(tick, POLL_INTERVAL_MS);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [conversationId, hasPending]);
}
