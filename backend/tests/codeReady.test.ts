// The Code ready check: every missing piece is named in plain words, in order, with who fixes it; nothing is started.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { codeReady, type CodeReadyDeps } from "@/lib/codeReady";

const healthy: CodeReadyDeps = {
  setting: (key) => (key === "coding.enabled" ? true : key === "coding.api.away" ? true : undefined),
  paused: () => false,
  pieces: async () => ({ stack: "ok", missing: null }),
  cannotFit: async () => null,
  runtime: async () => ({ kind: "ok", container_system: "running", image: "maipai-sandbox:local", image_built: true, network: true, detail: "" }),
  workspaceRoot: () => "/hub/stack/data/coding",
  stackCodingFolder: () => "/hub/stack/data/coding",
  folderWritable: () => true,
  slotOn: () => false,
  sandboxUrl: () => "http://192.0.2.1:3000/code/v1",
  port: () => 3000,
};
const with_ = (over: Partial<CodeReadyDeps>): CodeReadyDeps => ({ ...healthy, ...over });

describe("codeReady", () => {
  test("a home with everything is ready, Standard on, Boost and Max off, and the loopback address named", async () => {
    const r = await codeReady(healthy);
    expect(r.ready).toBe(true);
    expect(r.first_missing).toBeNull();
    expect(r.tiers).toEqual({ standard: "on", boost: "off", max: "off" });
    expect(r.gateway).toEqual({ loopback_url: "http://127.0.0.1:3000/code/v1", away_access: true, sandbox_url: "http://192.0.2.1:3000/code/v1" });
    expect(r.items.every((item) => item.who === "nobody")).toBe(true);
  });
  test("Coding off is the first thing missing and says where to turn it on", async () => {
    const r = await codeReady(with_({ setting: () => false }));
    expect(r.ready).toBe(false);
    expect(r.first_missing).toMatchObject({ id: "coding_on", who: "an admin" });
    expect(r.first_missing!.say).toContain("Settings");
  });
  test("a paused household says so", async () => {
    expect((await codeReady(with_({ paused: () => true }))).first_missing?.id).toBe("not_paused");
  });
  test("an engine that does not answer stops the model check from guessing", async () => {
    const r = await codeReady(with_({ pieces: async () => ({ stack: "unreachable", missing: null }) }));
    expect(r.items.filter((item) => !item.ok).map((item) => item.id)).toEqual(["engine", "model"]);
  });
  test("a missing coding model passes the engine's own sentence through; a model that cannot fit says why", async () => {
    expect((await codeReady(with_({ pieces: async () => ({ stack: "ok", missing: "The coding model is not installed. Install it from Settings, Coding." }) }))).first_missing?.say).toBe("The coding model is not installed. Install it from Settings, Coding.");
    expect((await codeReady(with_({ cannotFit: async () => "Not enough free memory." }))).first_missing).toMatchObject({ id: "model", say: "Not enough free memory." });
  });
  test("a work folder the engine will not open, and one Home cannot write, are named", async () => {
    expect((await codeReady(with_({ workspaceRoot: () => "/hub/data/coding" }))).first_missing).toMatchObject({ id: "folder", who: "the computer's owner" });
    expect((await codeReady(with_({ folderWritable: () => false }))).first_missing?.say).toContain("writable");
  });
  test("an engine on another computer is not held to the local folder rule", async () => {
    expect((await codeReady(with_({ workspaceRoot: () => "/anywhere/coding", stackCodingFolder: () => null }))).ready).toBe(true);
  });
  test("the sandbox system: stopped, image missing, engine too old and unreachable each say something different", async () => {
    const base = { kind: "ok", container_system: "running", image: "maipai-sandbox:local", image_built: true, network: true, detail: "" } as const;
    expect((await codeReady(with_({ runtime: async () => ({ ...base, container_system: "stopped" }) }))).first_missing?.say).toContain("container system start");
    expect((await codeReady(with_({ runtime: async () => ({ ...base, image_built: false }) }))).first_missing?.say).toContain("maipai-sandbox:local is not built");
    expect((await codeReady(with_({ runtime: async () => ({ kind: "old_engine" }) }))).first_missing?.say).toContain("too old");
    expect((await codeReady(with_({ runtime: async () => ({ kind: "unreachable" }) }))).first_missing?.id).toBe("sandbox");
    expect((await codeReady(with_({ runtime: async () => ({ ...base, network: false }) }))).ready).toBe(true);
  });
  test("a slot an admin turned on shows Boost on", async () => {
    expect((await codeReady(with_({ slotOn: (_c, tier) => tier === "boost" }))).tiers).toEqual({ standard: "on", boost: "on", max: "off" });
  });
  test("no gateway address is a named blocker", async () => {
    expect((await codeReady(with_({ sandboxUrl: () => "" }))).first_missing?.id).toBe("gateway");
  });
});

describe("GET /api/coding/ready", () => {
  beforeEach(() => resetDb());
  test("an owner reads it, with every item in plain words; an adult is refused", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await client.get("/api/coding/ready");
    expect(res.status).toBe(200);
    const body = await res.json() as { ready: boolean; items: Array<{ id: string; say: string }>; first_missing: { say: string } | null };
    expect(body.items.map((item) => item.id)).toEqual(["coding_on", "not_paused", "engine", "model", "folder", "sandbox", "gateway"]);
    expect(body.ready).toBe(false);
    expect(body.first_missing?.say.length).toBeGreaterThan(10);
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/coding/ready")).status).toBe(403);
  });
});
