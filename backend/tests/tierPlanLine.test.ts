// The admin Status line (GET /api/ai/tier-window `profile`) claims Reduced chat only when the Stack reports `reduced_chat`, over HTTP against a fake Stack.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createStackClient } from "@/lib/stack/client";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { resetReducedTruthForTests, setReducedChat } from "@/lib/reducedChat";
import { registerQueueProvider, releaseHouseholdQueue, resetActivePlanForTests, isolateQueueProvidersForTests, resetChatActivityForTests, resetDownshiftForTests, resetFitMemoryForTests, resetTierStateForTests, setBudgetReader, type QueueJob } from "@/lib/jobs/householdQueue";
import { setProfileSource } from "@/lib/jobs/admissionFit";
import type { ProfileRow } from "@/lib/jobs/profileTable";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

type Mode = "ok" | "waiting" | "failing";
let server: ReturnType<typeof Bun.serve>;
let mode: Mode;
let reduced: boolean;
let restoreProviders: () => void = () => undefined;

function useRow(row: ProfileRow, peak: Record<string, Record<string, number>>) {
  setProfileSource({ table: [row], hw: { budgetGb: 80, marginGb: 2, peakGb: peak, residentGb: { chat: { reduced: 5 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
}
beforeEach(() => {
  resetDb();
  restoreProviders = isolateQueueProvidersForTests();
  mode = "ok"; reduced = false;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/stack/v1/memory") return Response.json({ reduced_chat: reduced });
      if (path === "/stack/v1/tiers/reduced") {
        const { on } = (await req.json()) as { on: boolean };
        if (mode === "failing") return Response.json({ ok: false, reason: "no_room", reduced }, { status: 503 });
        if (mode === "waiting") return Response.json({ ok: false, waiting: true, reduced }, { status: 202 });
        reduced = on;
        return Response.json({ ok: true, swap_ms: 900, reduced });
      }
      return new Response("not found", { status: 404 });
    },
  });
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetFitMemoryForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
  setBudgetReader(async () => ({ freeMemoryBytes: 70e9, loaded: [] }));
});
afterEach(() => {
  restoreProviders();
  server.stop(true);
  __setStackClientForTests(null); setProfileSource(null); setBudgetReader(null); setReducedChat(null);
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
});

function job(id: string, jobClass: "video" | "picture", tier: "boost" | "max"): { job: QueueJob; remove: () => void } {
  const item: QueueJob = { id, personId: `p-${id}`, jobClass, state: "queued", createdAt: Date.now(), tier };
  const remove = registerQueueProvider(() => [{ job: item, save: () => undefined, applyFit: () => undefined, release: async () => { item.state = "running"; item.remainingSeconds = 600; } }]);
  return { job: item, remove };
}
async function profile(): Promise<string | null> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(db.select().from(people).where(eq(people.displayName, "Sage")).get()).toBeTruthy();
  resetReducedTruthForTests();
  const res = await client.get("/api/ai/tier-window");
  expect(res.status).toBe(200);
  return ((await res.json()) as { profile: string | null }).profile;
}
const maxRow: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "reduced" }, video: { state: "max" } } };

describe("the Status line claims Reduced chat only from the Stack", () => {
  test("a Boost job whose live-fit lowers chat shows no Reduced", async () => {
    useRow({ lead: "picture", tier: "boost", cells: { chat: { state: "reduced" }, picture: { state: "boost" } } }, { picture: { boost: 20 } });
    const { job: j, remove } = job("boost-1", "picture", "boost");
    try {
      await releaseHouseholdQueue();
      expect(j.state).toBe("running");
      expect(await profile()).toBe("Pictures: Boost");
    } finally { remove(); }
  });

  test("a Max job whose swap the Stack refuses shows no Reduced, and a stale Home flag with the Stack false shows none", async () => {
    useRow(maxRow, { video: { max: 40 } });
    mode = "failing";
    const { remove } = job("max-1", "video", "max");
    try {
      await releaseHouseholdQueue();
      setReducedChat({ minutesLeft: 5 });
      expect(await profile()).toBe("Video: Max");
    } finally { remove(); }
  });

  test("a Max job the Stack accepts shows Reduced", async () => {
    useRow(maxRow, { video: { max: 40 } });
    const { remove } = job("max-2", "video", "max");
    try {
      await releaseHouseholdQueue();
      expect(reduced).toBe(true);
      expect(await profile()).toBe("Chat: Reduced · Video: Max");
    } finally { remove(); }
  });

  test("a Max job planned to need it that has not started says it will simplify", async () => {
    useRow(maxRow, { video: { max: 40 } });
    mode = "waiting";
    const { job: j, remove } = job("max-3", "video", "max");
    try {
      await releaseHouseholdQueue();
      expect(j.state).toBe("queued");
      expect(await profile()).toBe("Chat: will simplify when the job starts");
    } finally { remove(); }
  });
});
