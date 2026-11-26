import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { __setChoicesFetchForTests } from "@/lib/stackChoicesForward";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { beginInstall } from "@/lib/installActions";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { installStackComponent, __setComponentsFetchForTests } from "@/lib/stackComponents";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let forwarded: Array<{ method: string; path: string; body: unknown }> = [];
let installBodies: unknown[] = [];

beforeEach(() => {
  resetDb(); forwarded = []; installBodies = [];
  __setChoicesFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    forwarded.push({ method: init?.method ?? "GET", path: url.pathname, body });
    if (url.pathname === "/stack/v1/licences" && init?.method === "POST") return Response.json({ terms_version: "v1", accepted: true, accepted_at: "now", by: body?.by, licences: [] });
    if (url.pathname === "/stack/v1/licences") return Response.json({ terms_version: "v1", accepted: false, accepted_at: null, by: null, licences: [] });
    return Response.json({ ok: true });
  }) as never);
});
afterEach(() => { __resetStackEngineForTests(); __setChoicesFetchForTests(null); __setComponentsFetchForTests(null); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}

describe("AI Stack licence proxy", () => {
  test("GET and POST forward to the Stack and Home stores no acceptance", async () => {
    const { client, actor } = await owner();
    expect((await client.get("/api/ai/stack/licences")).status).toBe(200);
    expect((await client.post("/api/ai/stack/licences", {})).status).toBe(200);
    expect(forwarded).toEqual([
      { method: "GET", path: "/stack/v1/licences", body: undefined },
      { method: "POST", path: "/stack/v1/licences", body: { by: actor.id } },
    ]);
    expect(db.select().from(settingsValues).where(eq(settingsValues.key, "_licences.accepted")).all()).toEqual([]);
  });

  test("a non-admin POST is refused", async () => {
    const { client, actor } = await owner();
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.post("/api/ai/stack/licences", {})).status).toBe(403);
    expect(forwarded).toEqual([]);
  });

  test("installing a licensed Stack component sends no Home acceptance", async () => {
    const disk = shippedDiskPlan("p128");
    const videoId = disk.rows.find((row) => row.id === "video-ltx25")!.model_ids[0]!;
    const model = (id: string) => ({ id, role: "video", url: `https://example.invalid/${id}`, sha256: "a".repeat(64), licence: "MIT", revision: "r", approx_bytes: 1, starter: false, installed: false });
    const plan = { level: "recommended", tier: "p128", label: "Test", memory_gb: 128, memory_source: "unified", models: [], optional_models: [model(videoId)], total_bytes: 0, remaining_bytes: 0, free_disk_bytes: 1e13, fits_disk: true, disk } as unknown as StackInstallPlan;
    const client = { installPlan: async () => plan, jobs: async () => [], models: async () => [], pullModel: async () => ({}), engineAction: async () => ({}) } as unknown as StackClient;
    __setStackClientForTests(client);
    __setComponentsFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST" && url.pathname.endsWith("/install")) {
        installBodies.push(init.body ? JSON.parse(String(init.body)) : undefined);
        return Response.json({ job: "job-1", component: "ltx-2-5-q8-distilled-mlx" }, { status: 202 });
      }
      return Response.json({ tier: "p128", free_disk_bytes: 1e13, disk_margin_bytes: 0, installed_bytes: 0, components: [{ id: "ffmpeg", state: "installed" }, { id: "ltx-2-5-q8-distilled-mlx", state: "notInstalled", licence: { id: "terms", name: "Terms", url: "https://example.invalid", summary: [], accepted_at: null } }] });
    }) as never);
    const started = await installStackComponent("ltx-2-5-q8-distilled-mlx");
    expect(started.job).toBe("job-1");
    expect(installBodies).toEqual([{}]);
    expect(forwarded.every((call) => !JSON.stringify(call.body).includes("accepted_licence"))).toBe(true);
  });
});
