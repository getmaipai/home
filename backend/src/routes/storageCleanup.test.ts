import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { storageRoutes } from "@/routes/storage";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/storage", storageRoutes);
const now = new Date().toISOString();
function addPerson(id: string, role: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
let runCalls = 0;
const stack = {
  tidyPlan: async () => ({ reclaimable_bytes: 10, items: [
    { id: "/models/safe", kind: "orphan_folder" as const, bytes: 10, reason: "Unreferenced folder.", blocked: null },
    { id: "/models/blocked", kind: "orphan_folder" as const, bytes: 20, reason: "Unreferenced folder.", blocked: "A role slot has selected this model." },
  ] }),
  tidyRun: async () => { runCalls++; return { dry_run: false, removed: [{ id: "/models/safe", kind: "orphan_folder" as const, bytes: 10, reason: "Unreferenced folder.", blocked: null }], skipped: [] }; },
} as unknown as StackClient;
const request = (path: string, token: string, method = "GET", body?: unknown) => app.request(`http://localhost/api/storage${path}`, { method, headers: { cookie: `session=${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => { resetDb(); runCalls = 0; __setStackClientForTests(stack); });
afterEach(() => { __resetStackEngineForTests(); resetDb(); });

describe("storage cleanup", () => {
  test("admin sees safe tidy candidates and blocked candidates as kept", async () => {
    const token = addPerson("storage-cleanup-admin", "admin");
    const response = await request("/cleanup", token);
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<{ id: string; blocked: string | null }>;
    expect(rows.some((row) => row.id === "tidy:/models/safe" && row.blocked === null)).toBe(true);
    expect(rows.some((row) => row.id === "tidy:/models/blocked" && row.blocked?.includes("selected this model"))).toBe(true);
  });
  test("rollback copies are one anonymous row and clear through the injected helper", async () => {
    const token = addPerson("storage-cleanup-rollbacks", "admin");
    const root = mkdtempSync(join(tmpdir(), "storage-rollbacks-"));
    const helper = join(root, "helper");
    writeFileSync(helper, "#!/bin/sh\nif [ \"$1\" = list ]; then printf 'data.rolled-back-20261117-000000\\t10\\ndata.rolled-back-20261118-000000\\t20\\ndata.rolled-back-20261119-000000\\t30\\n'; else printf '%s\\n' \"$@\" > \"$MAIPAI_TEST_PRUNED\"; fi\n");
    Bun.spawnSync(["chmod", "+x", helper]);
    process.env.MAIPAI_ROLLBACK_HELPER = helper;
    process.env.MAIPAI_INSTALL_ROOT = root;
    process.env.MAIPAI_TEST_PRUNED = join(root, "pruned");
    try {
      const response = await request("/cleanup", token);
      const rows = await response.json() as Array<{ id: string; kind?: string; label: string; bytes: number; reversible?: boolean; how?: string; blocked?: string | null }>;
      const rollback = rows.filter((row) => row.id === "rollback-copies");
      expect(rollback).toEqual([{ id: "rollback-copies", kind: "rollback_copies", label: "Old update backups", bytes: 10, reversible: true, how: "1 old update backups can be removed.", blocked: null }]);
      expect(JSON.stringify(rollback)).not.toContain("202611");
      const cleared = await request("/cleanup", token, "POST", { ids: ["rollback-copies"] });
      expect(cleared.status).toBe(200);
      expect((await import("node:fs")).readFileSync(process.env.MAIPAI_TEST_PRUNED!, "utf8")).toContain("data.rolled-back-20261117-000000");
    } finally {
      delete process.env.MAIPAI_ROLLBACK_HELPER; delete process.env.MAIPAI_INSTALL_ROOT; delete process.env.MAIPAI_TEST_PRUNED;
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("blocked and unknown ids are refused; safe listed item can be cleared", async () => {
    const token = addPerson("storage-cleanup-clear", "owner");
    expect((await request("/cleanup", token, "POST", { ids: ["tidy:/models/blocked"] })).status).toBe(400);
    expect((await request("/cleanup", token, "POST", { ids: ["unknown"] })).status).toBe(400);
    expect(runCalls).toBe(0);
    const response = await request("/cleanup", token, "POST", { ids: ["tidy:/models/safe"] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes_freed: 10 });
    expect(runCalls).toBe(1);
  });
  test("non-admin is refused", async () => {
    const token = addPerson("storage-cleanup-teen", "teen");
    expect((await request("/cleanup", token)).status).toBe(403);
  });
});
