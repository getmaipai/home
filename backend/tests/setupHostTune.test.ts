import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { replaceSetupStep } from "@/lib/setupState";

// The route runs scripts/studio/host-tune.sh. These tests swap in a stub script that
// records its argv, so the allowlist and the error mapping are checked without a Mac.
let dir: string;
let argvFile: string;
const item = { id: "power", title: "Never sleep", why: "w", mode: "consent", state: "needs", current: "sleep 1", proposed: "sleep 0" };

function stub(body: string) {
  const file = join(dir, "stub.sh");
  writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\n${body}\n`);
  chmodSync(file, 0o755);
  process.env.MAIPAI_HOST_TUNE_SCRIPT = file;
}

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "host-tune-route-")); argvFile = join(dir, "argv"); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MAIPAI_HOST_TUNE_SCRIPT; delete process.env.MAIPAI_HOST_TUNE_PLATFORM; });
beforeEach(() => { resetDb(); process.env.MAIPAI_HOST_TUNE_PLATFORM = "darwin"; });

const post = (verb: string, body: unknown) => new TestClient().post(`/api/setup/host-tune/${verb}`, body);
const argv = async () => (await Bun.file(argvFile).text()).trim().split("\n");

describe("setup host-tune routes", () => {
  test("GET returns the script's items", async () => {
    stub(`echo '{"supported":true,"items":[${JSON.stringify(item)}]}'`);
    const response = await new TestClient().get("/api/setup/host-tune");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ supported: true, items: [item] });
    expect((await argv()).slice(-1)).toEqual(["detect"]);
  });

  test("GET says supported=false off macOS without running the script", async () => {
    process.env.MAIPAI_HOST_TUNE_PLATFORM = "linux";
    stub("exit 9");
    const response = await new TestClient().get("/api/setup/host-tune");
    expect(await response.json()).toEqual({ supported: false, items: [] });
  });

  test("apply passes the id as one argument with --yes", async () => {
    stub(`echo '{"item":${JSON.stringify({ ...item, state: "applied" })}}'`);
    const response = await post("apply", { id: "power" });
    expect(response.status).toBe(200);
    expect((await response.json() as { item: { state: string } }).item.state).toBe("applied");
    expect((await argv()).slice(-3)).toEqual(["--yes", "apply", "power"]);
  });

  test("display-awake is allowed and reaches the script", async () => {
    stub(`echo '{"item":${JSON.stringify({ ...item, id: "display-awake", state: "applied" })}}'`);
    expect((await post("apply", { id: "display-awake" })).status).toBe(200);
    expect((await argv()).slice(-3)).toEqual(["--yes", "apply", "display-awake"]);
  });

  test("revert runs the revert verb", async () => {
    stub(`echo '{"item":${JSON.stringify(item)}}'`);
    expect((await post("revert", { id: "power" })).status).toBe(200);
    expect((await argv()).slice(-2)).toEqual(["revert", "power"]);
  });

  test("an id off the allowlist is refused and the script never runs", async () => {
    stub("exit 0");
    writeFileSync(argvFile, "untouched\n");
    for (const id of ["rm -rf /", "../power", "power; reboot", ""]) {
      expect((await post("apply", { id })).status).toBe(400);
    }
    expect(await argv()).toEqual(["untouched"]);
  });

  test("a change that needs an administrator comes back as 409 with the command", async () => {
    stub(`echo '{"error":"Never sleep changes the whole Mac, so it needs an administrator. At the Mac, run: sudo bash /x/host-tune.sh apply power --yes","code":"needs-root"}'; exit 3`);
    const response = await post("apply", { id: "power" });
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toContain("sudo bash");
  });

  test("a script that cannot run gives a 500 that says what to check", async () => {
    stub("echo boom >&2; exit 1");
    const response = await post("apply", { id: "power" });
    expect(response.status).toBe(500);
    expect((await response.json() as { error: string }).error).toContain("host-tune.sh");
  });

  test("apply is off on a computer that is not a Mac", async () => {
    process.env.MAIPAI_HOST_TUNE_PLATFORM = "linux";
    stub("exit 0");
    expect((await post("apply", { id: "power" })).status).toBe(409);
  });

  test("passes all five Home folders to the script", async () => {
    stub(`echo '{"supported":true,"items":[]}'`);
    await new TestClient().get("/api/setup/host-tune");
    const args = await argv();
    for (const flag of ["--data-dir", "--models-dir", "--engines-dir", "--media-dir", "--cache-dir"]) expect(args).toContain(flag);
  });

  test("after setup the owner reaches the routes and everyone else is refused", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" });
    replaceSetupStep("done", { status: "done" } as never);
    stub(`echo '{"supported":true,"items":[${JSON.stringify(item)}]}'`);
    expect((await owner.get("/api/setup/host-tune")).status).toBe(200);
    stub(`echo '{"item":${JSON.stringify({ ...item, state: "applied" })}}'`);
    expect((await owner.post("/api/setup/host-tune/apply", { id: "power" })).status).toBe(200);
    expect((await owner.post("/api/setup/host-tune/revert", { id: "power" })).status).toBe(200);
    const stranger = new TestClient("192.0.2.41");
    expect((await stranger.get("/api/setup/host-tune")).status).toBe(401);
    expect((await stranger.post("/api/setup/host-tune/apply", { id: "power" })).status).toBe(401);
  });
});
