import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { INSTALL_SH } from "./installFixtures";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "app-helper.sh");

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "app-helper-"));
  const launchctl = join(root, "launchctl");
  writeFileSync(launchctl, `#!/bin/sh\necho "$@" >> "${root}/calls"\n`);
  chmodSync(launchctl, 0o755);
  const binary = join(root, "fake-helper");
  writeFileSync(binary, "#!/bin/sh\nexit 0\n");
  chmodSync(binary, 0o755);
  const env = {
    ...process.env,
    HOME: root,
    MAIPAI_LAUNCHCTL: launchctl,
    MAIPAI_LAUNCH_AGENTS_DIR: join(root, "agents"),
    MAIPAI_APP_HELPER_DIR: join(root, "support"),
    MAIPAI_APP_HELPER_LOG: join(root, "logs", "app-helper.log"),
  };
  return { root, binary, env };
}

async function run(args: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawn(["bash", script, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { exitCode, stdout, stderr };
}

test("install writes a user LaunchAgent that runs the helper on a user-only socket, and remove undoes it", async () => {
  const { root, binary, env } = sandbox();
  const installed = await run(["install", binary], env);
  expect(installed.exitCode).toBe(0);
  const plist = join(root, "agents", "ai.maipai.app-helper.plist");
  const text = readFileSync(plist, "utf8");
  expect(text).toContain("<string>ai.maipai.app-helper</string>");
  expect(text).toContain(join(root, "support", "app-helper", "maipai-app-helper"));
  expect(text).toContain("--socket");
  expect(text).not.toContain("__HELPER_PATH__");
  expect(text).not.toContain("__LOG_PATH__");
  expect(readFileSync(join(root, "calls"), "utf8")).toContain("bootstrap");
  expect((await run(["status"], env)).stdout).toContain("agent: installed");

  const removed = await run(["remove"], env);
  expect(removed.exitCode).toBe(0);
  expect(existsSync(plist)).toBe(false);
  expect(existsSync(join(root, "support", "app-helper"))).toBe(false);
});

test("install refuses a missing binary with a plain sentence", async () => {
  const { root, env } = sandbox();
  const r = await run(["install", join(root, "nope")], env);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain("is not an executable");
});

test("install run as root hands the whole install to the person at the Mac's screen", async () => {
  const { root, binary, env } = sandbox();
  const r = await run(["install", binary], { ...env, MAIPAI_TEST_UID: "0", MAIPAI_CONSOLE_USER: process.env.USER ?? "nobody" });
  expect(r.exitCode).toBe(0);
  const calls = readFileSync(join(root, "calls"), "utf8");
  expect(calls).toContain("asuser");
  expect(calls).toContain("sudo -u");
  expect(calls).toContain("app-helper.sh install");
  // Nothing was written by the root pass itself.
  expect(existsSync(join(root, "agents"))).toBe(false);
});

test("install as root with nobody logged in stops with exit 11 and a plain next step", async () => {
  const { binary, env } = sandbox();
  const r = await run(["install", binary], { ...env, MAIPAI_TEST_UID: "0", MAIPAI_CONSOLE_USER: "root" });
  expect(r.exitCode).toBe(11);
  expect(r.stderr).toContain("Log in there");
});

test("build without the Swift toolchain stops with exit 10 and says what to run", async () => {
  const { root, env } = sandbox();
  const fake = join(root, "fakebin");
  mkdirSync(fake);
  writeFileSync(join(fake, "xcode-select"), "#!/bin/sh\nexit 2\n");
  chmodSync(join(fake, "xcode-select"), 0o755);
  const r = await run(["install"], { ...env, PATH: `${fake}:${process.env.PATH}` });
  expect(r.exitCode).toBe(10);
  expect(r.stderr).toContain("xcode-select --install");
  expect(existsSync(join(root, "agents"))).toBe(false);
});

describe("install.sh install_app_helper", () => {
  const call = (os: string, dir: string) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; install_app_helper ${os} "${dir}"`]);
  function tree(exitCode: number) {
    const dir = mkdtempSync(join(tmpdir(), "install-helper-"));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "app-helper.sh"), `#!/bin/bash\necho "ran $1" > "${dir}/ran"\nexit ${exitCode}\n`);
    return dir;
  }
  test("on a Mac it runs the helper install from the install folder", () => {
    const dir = tree(0);
    expect(call("darwin", dir).exitCode).toBe(0);
    expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran install");
  });
  test("a failed helper install never fails the installer and says Home still works", () => {
    const dir = tree(10);
    const r = call("darwin", dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("Home works without it");
  });
  test("Linux does nothing", () => {
    const dir = tree(0);
    expect(call("linux", dir).exitCode).toBe(0);
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });
});
