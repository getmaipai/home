import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
