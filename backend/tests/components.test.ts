// COMPONENTS-01: Settings, Models and storage. Owner and admin only; the Stack's refusals pass through as its
// own sentences; removing a style also clears Home's switch; a component install rides the install strip's data
// without ever gating chat.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __setComponentsFetchForTests, type StackComponent } from "@/lib/stackComponents";
import { summarizeBackground, summarizeInstall } from "@/lib/installStatus";
import { installGate } from "@/middleware/installGate";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const row = (over: Partial<StackComponent>): StackComponent => ({
  id: "z-image-turbo", label: "Pictures: Z-Image-Turbo", summary: "A higher-detail picture model.", group: "pictures", kind: "model", state: "notInstalled",
  size_bytes: null, download_bytes: 33_948_304_893, full_bytes: 33_948_304_893, required_free_bytes: 36_000_000_000, plan_need: "optional", requirement: "optional", requirement_reason: null,
  last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: true, install_block: null, can_uninstall: false, uninstall_block: "It is not installed.", ...over,
});

let calls: Array<{ method: string; path: string }> = [];
let answers: Record<string, () => Response> = {};
beforeEach(() => {
  resetDb(); calls = []; answers = {};
  __setComponentsFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, path });
    const key = `${method} ${path}`;
    if (!answers[key]) return Response.json({ error: `unscripted ${key}`, code: "unscripted" }, { status: 500 });
    return answers[key]!();
  }) as never);
});
afterEach(() => __setComponentsFetchForTests(null));

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

describe("the list", () => {
  test("a music component in group music passes through the list route", async () => {
    const { client } = await owner();
    answers["GET /stack/v1/components"] = () => Response.json({ tier: "p128", free_disk_bytes: 1_500_000_000_000, disk_margin_bytes: 5e9, installed_bytes: 0, components: [row({ id: "music", label: "Music: ACE-Step 1.5", group: "music" })] });
    const res = await client.get("/api/components");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { components: Array<{ id: string; group: string }> }).components[0]).toMatchObject({ id: "music", group: "music" });
  });
  test("is the Stack's list with a stack flag", async () => {
    const { client } = await owner();
    answers["GET /stack/v1/components"] = () => Response.json({ tier: "p128", free_disk_bytes: 1_500_000_000_000, disk_margin_bytes: 5e9, installed_bytes: 0, components: [row({})] });
    const body = await (await client.get("/api/components")).json() as { stack: string; tier: string; components: Array<{ id: string; plan_need: string }> };
    expect(body).toMatchObject({ stack: "ok", tier: "p128" });
    expect(body.components[0]).toMatchObject({ id: "z-image-turbo", plan_need: "optional" });
  });
  test("with the engine down it is an empty list and a sentence, not an error page", async () => {
    const { client } = await owner();
    __setComponentsFetchForTests((async () => { throw new Error("refused"); }) as never);
    const res = await client.get("/api/components");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stack: "unreachable", components: [], message: "The engine isn't answering. Check that the engine is running, then try again." });
  });
  test("only an owner or admin may read, install or remove", async () => {
    const { client, actor } = await owner();
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/components")).status).toBe(403);
    expect((await client.request("/api/components/z-image-turbo/install", { method: "POST" })).status).toBe(403);
    expect((await client.request("/api/components/z-image-turbo", { method: "DELETE" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("install and uninstall", () => {
  test("install starts the Stack's job; a second tap joins it; already installed is a plain 200", async () => {
    const { client } = await owner();
    answers["POST /stack/v1/components/z-image-turbo/install"] = () => Response.json({ job: "job-1", component: "z-image-turbo", joined: false }, { status: 202 });
    const res = await client.request("/api/components/z-image-turbo/install", { method: "POST" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job: "job-1", component: "z-image-turbo" });
    answers["POST /stack/v1/components/z-image-turbo/install"] = () => Response.json({ job: null, component: "z-image-turbo", already_installed: true });
    const again = await client.request("/api/components/z-image-turbo/install", { method: "POST" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ job: null, component: "z-image-turbo" });
  });
  test("the Stack's refusal reaches the person as its own sentence", async () => {
    const { client } = await owner();
    answers["POST /stack/v1/components/z-image-turbo/install"] = () => Response.json({ error: "Not enough room: it needs about 36 GB and this computer has 20 GB free. Free some space first.", code: "not_enough_space" }, { status: 409 });
    const res = await client.request("/api/components/z-image-turbo/install", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Not enough room: it needs about 36 GB and this computer has 20 GB free. Free some space first.", code: "not_enough_space" });
    answers["DELETE /stack/v1/components/qwen3-1.7b-q8-0"] = () => Response.json({ error: "This is the only chat model installed. Install another one first so chat keeps working.", code: "only_chat_model" }, { status: 409 });
    const removal = await client.request("/api/components/qwen3-1.7b-q8-0", { method: "DELETE" });
    expect(removal.status).toBe(409);
    expect(await removal.json()).toMatchObject({ code: "only_chat_model" });
  });
  test("uninstall reports the space freed; a style also leaves Home's switches", async () => {
    const { client } = await owner();
    answers["DELETE /stack/v1/components/z-image-turbo"] = () => Response.json({ component: "z-image-turbo", freed_bytes: 33_948_304_893, removed: true });
    expect(await (await client.request("/api/components/z-image-turbo", { method: "DELETE" })).json()).toEqual({ component: "z-image-turbo", freed_bytes: 33_948_304_893, removed: true });
    answers["DELETE /stack/v1/components/lora.picture.lora-aaaaaaaaaaaaaaaa"] = () => Response.json({ component: "lora.picture.lora-aaaaaaaaaaaaaaaa", freed_bytes: 100, removed: true });
    const res = await client.request("/api/components/lora.picture.lora-aaaaaaaaaaaaaaaa", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toEqual({ method: "DELETE", path: "/stack/v1/components/lora.picture.lora-aaaaaaaaaaaaaaaa" });
  });
});

let n = 0;
function job(kind: string, state: StackJob["state"], done: number, total: number, input: Record<string, unknown>): StackJob {
  n += 1;
  return { id: `j${n}`, kind, role: "image", state, percent: 0, completedBytes: done, totalBytes: total, status: state, position: null, input, result: null, reason: null, createdAt: `2026-10-17T10:00:${String(n).padStart(2, "0")}.000Z`, updatedAt: "2026-10-17T10:00:00.000Z", bytesPerSecond: 1_000_000 } as StackJob;
}

describe("the install strip's data", () => {
  test("a component install is background progress and never changes the gates that hold chat and voice", async () => {
    const jobs = [job("component.install", "running", 10_000_000_000, 34_000_000_000, { component: "z-image-turbo", model: "z-image-turbo", label: "Pictures: Z-Image-Turbo" })];
    const main = summarizeInstall(jobs);
    expect(main.state).toBe("none");
    const background = summarizeBackground(jobs)!;
    expect(background).toMatchObject({ state: "running", label: "Downloading Pictures: Z-Image-Turbo", percent: 29, count: 1 });
    expect(background.etaSeconds).toBe(24_000);
    const gate = installGate("all", async () => ({ ...main, background }));
    let reached = false;
    const res = await gate({ req: { method: "POST" }, json: () => new Response(null, { status: 503 }) } as never, async () => { reached = true; });
    expect(reached).toBe(true);
    expect(res).toBeUndefined();
  });
  test("two parts read as one line; a finished or failed one is not shown (a failure is a Repairs item)", () => {
    const two = [job("component.install", "running", 1, 10, { label: "Video: Wan 2.2" }), job("component.install", "queued", 0, 10, { label: "Pictures: Tiny" })];
    expect(summarizeBackground(two)).toMatchObject({ label: "Downloading 2 parts", count: 2 });
    expect(summarizeBackground([job("component.install", "failed", 1, 10, { label: "x" }), job("component.install", "done", 10, 10, { label: "y" })])).toBeNull();
    expect(summarizeBackground([job("model.install", "running", 1, 10, { model: "x" })])).toBeNull();
  });
});
