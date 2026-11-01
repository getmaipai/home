import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { installHelper } from "@/lib/appHelperInstall";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { replaceSetupStep } from "@/lib/setupState";

const dir = mkdtempSync(join(tmpdir(), "close-apps-route-"));
const socketPath = join(dir, "helper.sock");
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MAIPAI_APP_HELPER_SOCKET; delete process.env.MAIPAI_APP_HELPER_SCRIPT; delete process.env.MAIPAI_TEST_PLATFORM; });
beforeEach(() => { resetDb(); process.env.MAIPAI_APP_HELPER_SOCKET = socketPath; process.env.MAIPAI_TEST_PLATFORM = "linux"; delete process.env.MAIPAI_APP_HELPER_SCRIPT; });

async function withHelper<T>(reply: (request: { op: string }) => unknown, run: () => Promise<T>): Promise<T> {
  const server = createServer((socket) => socket.on("data", (chunk) => socket.write(`${JSON.stringify(reply(JSON.parse(chunk.toString())))}\n`)));
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try { return await run(); } finally { await new Promise((resolve) => server.close(resolve)); }
}

describe("setup close-apps routes", () => {
  test("GET says not installed when nothing answers", async () => {
    process.env.MAIPAI_APP_HELPER_SOCKET = join(dir, "missing.sock");
    const body = await (await new TestClient().get("/api/setup/close-apps")).json();
    expect(body).toEqual({ installed: false, can_install: false, apps: [] });
  });
  test("GET lists app names and bundle ids only", async () => {
    const body = await withHelper(() => ({ ok: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari", bytes: 5, frontmost: true }] }), async () => (await new TestClient().get("/api/setup/close-apps")).json());
    expect(body).toEqual({ installed: true, can_install: false, apps: [{ bundleId: "com.apple.Safari", name: "Safari" }] });
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

  test("GET says can_install on a Mac that carries the installer, and not otherwise", async () => {
    process.env.MAIPAI_APP_HELPER_SOCKET = join(dir, "missing.sock");
    process.env.MAIPAI_TEST_PLATFORM = "darwin";
    process.env.MAIPAI_APP_HELPER_SCRIPT = fakeScript(0);
    expect(await (await new TestClient().get("/api/setup/close-apps")).json()).toEqual({ installed: false, can_install: true, apps: [] });
    process.env.MAIPAI_TEST_PLATFORM = "linux";
    expect(((await (await new TestClient().get("/api/setup/close-apps")).json()) as { can_install: boolean }).can_install).toBe(false);
    delete process.env.MAIPAI_TEST_PLATFORM; delete process.env.MAIPAI_APP_HELPER_SCRIPT;
  });
  test("POST install: installed once the helper answers, with Close apps untouched", async () => {
    process.env.MAIPAI_TEST_PLATFORM = "darwin";
    process.env.MAIPAI_APP_HELPER_SCRIPT = fakeScript(0);
    const body = await withHelper(() => ({ ok: true, apps: [] }), async () => (await new TestClient().post("/api/setup/close-apps/install", {})).json());
    expect((body as { result: string }).result).toBe("installed");
    delete process.env.MAIPAI_TEST_PLATFORM; delete process.env.MAIPAI_APP_HELPER_SCRIPT;
  });
  test("POST install is closed once setup is finished", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
    replaceSetupStep("done", { status: "done" } as never);
    expect((await owner.post("/api/setup/close-apps/install", {})).status).toBe(409);
  });
});

function fakeScript(code: number): string {
  const path = join(dir, `fake-helper-${code}.sh`);
  writeFileSync(path, `#!/bin/bash\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("installHelper", () => {
  test("each exit code of the script maps to a plain result that says what to do", async () => {
    process.env.MAIPAI_TEST_PLATFORM = "darwin";
    process.env.MAIPAI_APP_HELPER_SCRIPT = fakeScript(0);
    const code = (n: number) => installHelper(async () => n, 300);
    expect((await code(10)).result).toBe("no_toolchain");
    expect((await code(10)).message).toContain("xcode-select --install");
    expect((await code(11)).result).toBe("nobody_logged_in");
    expect((await code(1)).result).toBe("failed");
    delete process.env.MAIPAI_TEST_PLATFORM; delete process.env.MAIPAI_APP_HELPER_SCRIPT;
  });
  test("a script that exits 0 but leaves no helper answering is reported failed, never installed", async () => {
    process.env.MAIPAI_TEST_PLATFORM = "darwin";
    process.env.MAIPAI_APP_HELPER_SCRIPT = fakeScript(0);
    process.env.MAIPAI_APP_HELPER_SOCKET = join(dir, "missing.sock");
    expect((await installHelper(async () => 0, 600)).result).toBe("failed");
    delete process.env.MAIPAI_TEST_PLATFORM; delete process.env.MAIPAI_APP_HELPER_SCRIPT;
  });
  test("a computer that is not a Mac is told so and runs nothing", async () => {
    process.env.MAIPAI_TEST_PLATFORM = "linux";
    let ran = false;
    expect((await installHelper(async () => { ran = true; return 0; })).result).toBe("not_mac");
    expect(ran).toBe(false);
    delete process.env.MAIPAI_TEST_PLATFORM;
  });
});
