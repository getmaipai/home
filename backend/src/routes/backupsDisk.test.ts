import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { backupsRoutes } from "@/routes/backups";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/backups", backupsRoutes);
const now = new Date().toISOString();

beforeEach(() => {
  resetDb();
  const token = "backup-disk-token";
  db.insert(people).values({ id: "backup-disk-admin", displayName: "Admin", role: "admin", avatarSeed: "admin", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  db.insert(sessions).values({ id: "backup-disk-session", personId: "backup-disk-admin", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  __setStackClientForTests({ disk: async () => ({ level: "critical", volumes: [], missing: [] }) } as never);
});
afterEach(() => { __resetStackEngineForTests(); resetDb(); });

describe("backup disk admission", () => {
  test("refuses before starting with the plain storage line", async () => {
    const response = await app.request("http://localhost/api/backups/run", { method: "POST", headers: { cookie: "session=backup-disk-token" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "There is not enough room left on this computer for that. Free up space in Settings, then try again." });
  });
});
