import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { createStackClient } from "@/lib/stack/client";
import { startStackEventBridge, type StackEventEnvelope } from "@/lib/stack/events";
import { listPending } from "@/lib/notifications";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

const BASE = "http://127.0.0.1:8770";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

// One SSE frame per event, exactly the shape
// stack/docs/integrations.md shows:
//
//   id: 1
//   event: job.done
//   data: {...}
//
// (blank line between frames).
function sseFrame(envelope: StackEventEnvelope): string {
  return `id: ${envelope.seq}\nevent: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

function streamResponse(frames: string[]): Response {
  const bytes = new TextEncoder().encode(frames.join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function waitFor(predicate: () => boolean, ms = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function ownerRow(): Promise<PersonRow> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
}

describe("stack event bridge: SSE parsing", () => {
  test("fires onEvent once per distinct seq across one stream", async () => {
    const events: StackEventEnvelope[] = [];
    const frames = [
      { id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } },
      { id: "job.progress", at: "2026-09-20T00:00:02Z", seq: 2, data: { job: "j1", status: "in_progress", percent: 40 } },
      { id: "model.installed", at: "2026-09-20T00:00:03Z", seq: 3, data: { model: "qwen3-8b" } },
    ] satisfies StackEventEnvelope[];
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () => streamResponse(frames.map(sseFrame))      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 3);
    bridge.stop();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(bridge.lastSeq()).toBe(3);
  });

  test("a frame split across two chunks still parses as one event", async () => {
    const events: StackEventEnvelope[] = [];
    const full = sseFrame({ id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } });
    const cut = 10;
    const chunkA = full.slice(0, cut);
    const chunkB = full.slice(cut);
    let call = 0;
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      // First call: a stream that delivers chunkA then chunkB then closes.
      // Subsequent calls (the reconnect after the stream ended): a dead
      // socket, null, so the bridge just backs off and retries.
      fetch: (async () => {
        call += 1;
        if (call > 1) return null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(chunkA));
            controller.enqueue(new TextEncoder().encode(chunkB));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 1);
    bridge.stop();
    expect(events[0]!.seq).toBe(1);
    expect(events[0]!.data.job).toBe("j1");
  });

  test("a malformed frame is skipped without killing the stream", async () => {
    const events: StackEventEnvelope[] = [];
    const good = sseFrame({ id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } });
    const malformed = "id: 2\nevent: job.done\ndata: {not json}\n\n";
    const good2 = sseFrame({ id: "job.done", at: "2026-09-20T00:00:02Z", seq: 3, data: { job: "j2", status: "done" } });
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () => streamResponse([good, malformed, good2])      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 2);
    bridge.stop();
    expect(events.map((e) => e.seq)).toEqual([1, 3]);
  });
});

describe("stack event bridge: notification mapping", () => {
  test("update.available fires engines.update_available for the admin", async () => {
    const row = await ownerRow();
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([sseFrame({ id: "update.available", at: "2026-09-20T00:00:01Z", seq: 1, data: { name: "llama", available: "0.2.0" } })])
      ) as unknown as typeof fetch,
    });
    await waitFor(() => listPending(row).some((d) => d.typeId === "engines.update_available"));
    bridge.stop();
    const delivery = listPending(row).find((d) => d.typeId === "engines.update_available")!;
    expect(delivery.text).toBe("The llama engine has an update available: 0.2.0.");
  });

  test("update.applied fires engines.update_applied", async () => {
    const row = await ownerRow();
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([sseFrame({ id: "update.applied", at: "2026-09-20T00:00:01Z", seq: 1, data: { name: "llama", tag: "0.2.0" } })])
      ) as unknown as typeof fetch,
    });
    await waitFor(() => listPending(row).some((d) => d.typeId === "engines.update_applied"));
    bridge.stop();
    const delivery = listPending(row).find((d) => d.typeId === "engines.update_applied")!;
    expect(delivery.text).toBe("The llama engine updated to 0.2.0.");
  });

  test("update.failed fires engines.update_failed", async () => {
    const row = await ownerRow();
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([sseFrame({ id: "update.failed", at: "2026-09-20T00:00:01Z", seq: 1, data: { name: "llama", reason: "the download failed" } })])
      ) as unknown as typeof fetch,
    });
    await waitFor(() => listPending(row).some((d) => d.typeId === "engines.update_failed"));
    bridge.stop();
    const delivery = listPending(row).find((d) => d.typeId === "engines.update_failed")!;
    expect(delivery.text).toBe("The llama engine failed to update: the download failed.");
  });

  test("health.changed open warning fires engines.problem", async () => {
    const row = await ownerRow();
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([sseFrame({ id: "health.changed", at: "2026-09-20T00:00:01Z", seq: 1, data: { code: "engine_offline", severity: "warning", title: "The engine is offline", open: true } })])
      ) as unknown as typeof fetch,
    });
    await waitFor(() => listPending(row).some((d) => d.typeId === "engines.problem"));
    bridge.stop();
    const delivery = listPending(row).find((d) => d.typeId === "engines.problem")!;
    expect(delivery.text).toBe("Engine problem: The engine is offline. See Repairs.");
  });

  test("health.changed closed or info severity does not notify", async () => {
    const row = await ownerRow();
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([
          sseFrame({ id: "health.changed", at: "2026-09-20T00:00:01Z", seq: 1, data: { code: "engine_offline", severity: "warning", title: "The engine is offline", open: false } }),
          sseFrame({ id: "health.changed", at: "2026-09-20T00:00:02Z", seq: 2, data: { code: "memory", severity: "info", title: "Memory usage", open: true } }),
        ])
      ) as unknown as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 300));
    bridge.stop();
    expect(listPending(row).some((d) => d.typeId === "engines.problem")).toBe(false);
  });

  test("events that never notify still reach onEvent", async () => {
    const events: StackEventEnvelope[] = [];
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () =>
        streamResponse([sseFrame({ id: "role.state", at: "2026-09-20T00:00:01Z", seq: 1, data: { role: "chat", state: "ready" } })])
      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 1);
    bridge.stop();
    expect(events[0]!.id).toBe("role.state");
  });
});

describe("stack event bridge: reconnect and replay", () => {
  test("a dropped stream reconnects and replays from the last seen seq", async () => {
    const events: StackEventEnvelope[] = [];
    // First stream: seq 1 and 2, then the socket dies. Second stream
    // (the replay): the same seq 1 and 2 again plus a brand-new seq 3.
    const first = [
      sseFrame({ id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } }),
      sseFrame({ id: "job.progress", at: "2026-09-20T00:00:02Z", seq: 2, data: { job: "j1", status: "in_progress", percent: 40 } }),
    ];
    const second = [
      sseFrame({ id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } }),
      sseFrame({ id: "job.progress", at: "2026-09-20T00:00:02Z", seq: 2, data: { job: "j1", status: "in_progress", percent: 40 } }),
      sseFrame({ id: "job.done", at: "2026-09-20T00:00:03Z", seq: 3, data: { job: "j2", status: "done" } }),
    ];
    let call = 0;
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () => {
        call += 1;
        return streamResponse(call === 1 ? first : second);
      }      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 5);
    bridge.stop();
    // First stream delivered seq 1, seq 2. The replay re-sent seq 1 and
    // seq 2 (both already seen, so onEvent fired for them again - the
    // bridge does NOT dedupe onEvent, only notifications), plus the fresh
    // seq 3. Total: 5 onEvent calls, seqs [1, 2, 1, 2, 3].
    expect(events.length).toBe(5);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 1, 2, 3]);
    expect(bridge.lastSeq()).toBe(3);
  });
});

describe("stack event bridge: stop", () => {
  test("stop() halts the bridge and no further events arrive", async () => {
    const events: StackEventEnvelope[] = [];
    const client = createStackClient({ baseUrl: BASE });
    const bridge = startStackEventBridge(client, {
      baseUrl: BASE,
      fetch: (async () => streamResponse([sseFrame({ id: "job.done", at: "2026-09-20T00:00:01Z", seq: 1, data: { job: "j1", status: "done" } })])      ) as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => events.length === 1);
    bridge.stop();
    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBe(1);
  });
});
