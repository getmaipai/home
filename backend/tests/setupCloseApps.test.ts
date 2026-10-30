import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { replaceSetupStep } from "@/lib/setupState";

const dir = mkdtempSync(join(tmpdir(), "close-apps-route-"));
const socketPath = join(dir, "helper.sock");
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MAIPAI_APP_HELPER_SOCKET; });
beforeEach(() => { resetDb(); process.env.MAIPAI_APP_HELPER_SOCKET = socketPath; });

async function withHelper<T>(reply: (request: { op: string }) => unknown, run: () => Promise<T>): Promise<T> {
  const server = createServer((socket) => socket.on("data", (chunk) => socket.write(`${JSON.stringify(reply(JSON.parse(chunk.toString())))}\n`)));
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try { return await run(); } finally { await new Promise((resolve) => server.close(resolve)); }
}

describe("setup close-apps routes", () => {
  test("GET says not installed when nothing answers", async () => {
    process.env.MAIPAI_APP_HELPER_SOCKET = join(dir, "missing.sock");
    const body = await (await new TestClient().get("/api/setup/close-apps")).json();
    expect(body).toEqual({ installed: false, apps: [] });
  });
  test("GET lists app names and bundle ids only", async () => {
    const body = await withHelper(() => ({ ok: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari", bytes: 5, frontmost: true }] }), async () => (await new TestClient().get("/api/setup/close-apps")).json());
    expect(body).toEqual({ installed: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari" }] });
  });
  test("POST test reports no_helper without a helper", async () => {
    process.env.MAIPAI_APP_HELPER_SOCKET = join(dir, "missing.sock");
    const response = await new TestClient().post("/api/setup/close-apps/test", {});
    expect(await response.json()).toEqual({ result: "no_helper" });
  });
  test("a signed-out caller is refused once an owner exists, and everyone once setup is done", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
    expect((await new TestClient("192.0.2.41").get("/api/setup/close-apps")).status).toBe(401);
    replaceSetupStep("done", { status: "done" } as never);
    expect((await owner.get("/api/setup/close-apps")).status).toBe(409);
  });
});
