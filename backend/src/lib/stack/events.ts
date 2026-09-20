// Home's Stack event bridge (HOME-STACK-03, 2026-09-20): Home is the only
// subscriber of the Stack's event feed (stack/docs/integrations.md "the
// event feed" - the Stack never notifies a person; Home's notification
// system is the only thing that does). This module opens the SSE stream
// at <base URL>/stack/v1/events, parses each envelope against
// stack-event.schema.json's field names, reconnects with backoff (1 s
// doubling to 30 s) carrying Last-Event-Id so the Stack's 500-event
// in-memory ring replays what was missed, and maps the feed onto the two
// surfaces a Stack event can become: a notification for a household
// admin (the three update events plus an opened warning/critical health
// item), or a live in-process event for the Engines page's live view
// (04b's wiring; nothing subscribes yet).
//
// Never throws out of the stream loop: a malformed event is logged once
// and skipped, a dead socket is retried, and an unhandled error inside a
// mapped trigger is caught so one bad event cannot kill the whole
// bridge. Nothing calls startStackEventBridge() from index.ts yet -
// that wiring is HOME-STACK-02b.
import { trigger } from "@/lib/notifications";
import type { StackClient } from "./client";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const LOG_PREFIX = "[stack-events]";
const EVENT_IDS: readonly string[] = [
  "role.state",
  "engine.state",
  "pressure",
  "job.progress",
  "job.done",
  "model.installed",
  "update.available",
  "update.applied",
  "update.failed",
  "health.changed",
];

/** The StackEvent envelope (spec stack-event.schema.json): `{ id, at,
 * seq, data }`. `data`'s per-id shape is validated loosely - only the
 * fields each mapping reads are checked, an extra field is fine, and a
 * missing required one makes the event malformed (logged once, skipped),
 * matching the schema's required list exactly. */
export interface StackEventEnvelope {
  id:
    | "role.state"
    | "engine.state"
    | "pressure"
    | "job.progress"
    | "job.done"
    | "model.installed"
    | "update.available"
    | "update.applied"
    | "update.failed"
    | "health.changed";
  at: string;
  seq: number;
  data: Record<string, unknown>;
}

export interface StackEventBridgeOptions {
  /** The base URL of the Stack to stream from (the client's own; the
   * event feed lives at `<base>/stack/v1/events`). Defaults to the
   * client's default loopback base. */
  baseUrl?: string;
  /** Receives every event, mapped or not; the Engines page's live view
   * will subscribe to it (04b). Never required - a bridge with no
   * listener still maps its notification events. */
  onEvent?: (event: StackEventEnvelope) => void;
  /** Injectable for tests: the fetch to open the SSE stream. */
  fetch?: typeof fetch;
}

export interface StackEventBridge {
  stop(): void;
  /** The last `seq` seen on the wire, `-1` before the first event.
   * Exposed for tests; production callers use stop() only. */
  lastSeq(): number;
}

function isEnvelope(value: unknown): value is StackEventEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && EVENT_IDS.includes(v.id) && typeof v.at === "string" && typeof v.seq === "number" && typeof v.data === "object" && v.data !== null;
}

/** Which notification (if any) one envelope maps to. Returns `null` for
 * events that never notify. `health.changed` with an opened item of
 * severity warning or critical is `engines.problem`; a closed item maps
 * to nothing - the Repairs list already shows it. */
function notificationFor(event: StackEventEnvelope): { typeId: string; vars: Record<string, string> } | undefined {
  switch (event.id) {
    case "update.available": {
      const d = event.data;
      const name = typeof d.name === "string" ? d.name : "";
      const available = typeof d.available === "string" ? d.available : "";
      if (!name || !available) return undefined;
      return { typeId: "engines.update_available", vars: { name, version: available } };
    }
    case "update.applied": {
      const d = event.data;
      const name = typeof d.name === "string" ? d.name : "";
      const tag = typeof d.tag === "string" ? d.tag : "";
      if (!name) return undefined;
      return { typeId: "engines.update_applied", vars: { name, tag } };
    }
    case "update.failed": {
      const d = event.data;
      const name = typeof d.name === "string" ? d.name : "the Stack";
      const reason = typeof d.reason === "string" ? d.reason : "the Stack did not say why";
      return { typeId: "engines.update_failed", vars: { name, reason } };
    }
    case "health.changed": {
      const d = event.data;
      const code = typeof d.code === "string" ? d.code : "";
      const severity = typeof d.severity === "string" ? d.severity : "";
      const title = typeof d.title === "string" ? d.title : "";
      if (!code || !title) return undefined;
      if (d.open !== true) return undefined;
      if (severity !== "warning" && severity !== "critical") return undefined;
      return { typeId: "engines.problem", vars: { title, fix: "See Repairs." } };
    }
    default:
      return undefined;
  }
}

/** Fire the mapped notification (if any, and if this seq is new), then
 * hand the envelope to onEvent. Returns `true` if the seq was new. The
 * seq itself is the repeat key: the in-memory ring replays exactly the
 * envelopes already seen, so a replayed envelope has the same seq and is
 * skipped, and a brand-new envelope always has a new one. */
function handleEvent(
  event: StackEventEnvelope,
  seen: Set<number>,
  onEvent?: (event: StackEventEnvelope) => void,
): boolean {
  const fresh = !seen.has(event.seq);
  if (fresh) seen.add(event.seq);
  if (fresh) {
    const mapped = notificationFor(event);
    if (mapped) {
      trigger(mapped.typeId, mapped.vars)
        .then(() => undefined)
        .catch((err: unknown) => console.error(`${LOG_PREFIX} notification for ${event.id} failed: ${(err as Error).message}`));
    }
  }
  if (onEvent) {
    try {
      onEvent(event);
    } catch (err: unknown) {
      console.error(`${LOG_PREFIX} onEvent handler failed: ${(err as Error).message}`);
    }
  }
  return fresh;
}

/** Parse an SSE byte chunk into a list of complete events plus the
 * leftover partial frame. Frames are blank-line separated; a frame is
 * complete once its terminating blank line arrives. A trailing frame
 * with no blank line (the Stream's last frame before a close) is kept
 * as `pending` - it either completes on the next chunk (a slow writer)
 * or is dropped at stream end, which is safe: the reconnect replays from
 * the last seq actually seen, and a frame lost at the edge of a drop is
 * one the ring still has. */
function parseSse(chunk: string, pending: string): { events: StackEventEnvelope[]; pending: string; malformed: boolean } {
  const text = pending + chunk;
  const frames = text.split(/\n\n/);
  const lastFrame = frames.pop() ?? "";
  const events: StackEventEnvelope[] = [];
  let malformed = false;
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let eventId: string | null = null;
    let dataParts: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventId = line.slice(6).trim();
      else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
    }
    if (!eventId || dataParts.length === 0) {
      malformed = true;
      continue;
    }
    const raw = dataParts.join("\n");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      malformed = true;
      continue;
    }
    if (!isEnvelope(value)) {
      malformed = true;
      continue;
    }
    events.push(value);
  }
  return { events, pending: lastFrame, malformed };
}

export function startStackEventBridge(client: StackClient, options: StackEventBridgeOptions = {}): StackEventBridge {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "http://127.0.0.1:8770").replace(/\/$/, "");
  const seen = new Set<number>();
  let lastSeq = -1;
  let stopped = false;
  let backoff = INITIAL_BACKOFF_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loggedMalformed = false;

  async function readStream(res: Response): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const { events, pending: leftover, malformed } = parseSse(chunk, pending);
        pending = leftover;
        if (malformed && !loggedMalformed) {
          loggedMalformed = true;
          console.error(`${LOG_PREFIX} malformed event on the feed; skipping`);
        }
        for (const event of events) {
          if (event.seq > lastSeq) lastSeq = event.seq;
          handleEvent(event, seen, options.onEvent);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    try {
      const headers: Record<string, string> = {};
      if (lastSeq >= 0) headers["last-event-id"] = String(lastSeq);
      const res = await doFetch(`${base}/stack/v1/events`, { headers });
      if (!res.ok || !res.body) {
        throw new Error(`the Stack answered ${res.status} on the event feed`);
      }
      backoff = INITIAL_BACKOFF_MS;
      await readStream(res);
    } catch (err: unknown) {
      if (stopped) return;
      console.error(`${LOG_PREFIX} event feed connection failed: ${(err as Error).message}; reconnecting in ${backoff}ms`);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        timer = null;
        void connect();
      }, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  void connect();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    lastSeq() {
      return lastSeq;
    },
  };
}
