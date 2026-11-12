// HOST-GUARD-08: after the host guard restarts the Mac's file-event service it writes fsevents-restarted; a dev hub's watch loop then
// restarts the whole hub (a fresh start rereads every file from disk, so an edit made during the restart window is picked up).
// The guard never touches a user process; only dev.sh restarts its own hub. MAIPAI_DEV_RESTART_CMD stands in for the real restart.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "maipai-dev-fsev-"));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin")("a new file-event service restart makes the dev hub restart itself; an old one does not", async () => {
  const root = join(scratch, "wt"); const state = join(root, "data", "dev"); const guard = join(scratch, "guard");
  mkdirSync(join(root, "scripts"), { recursive: true }); mkdirSync(state, { recursive: true }); mkdirSync(guard);
  writeFileSync(join(root, ".git"), "gitdir: /nowhere\n");
  copyFileSync(join(import.meta.dir, "dev.sh"), join(root, "scripts", "dev.sh"));
  const fakeVite = join(scratch, "vite"); writeFileSync(fakeVite, "#!/bin/bash\nsleep 60\n"); chmodSync(fakeVite, 0o755);
  const vite = Bun.spawn(["/bin/bash", fakeVite]);
  writeFileSync(join(state, "vite.pid"), `${vite.pid}\n`);
  writeFileSync(join(guard, "fsevents-restarted"), JSON.stringify({ version: 1, restarted_at: 1000 }));
  const marker = join(scratch, "restarted");
  const watch = Bun.spawn(["/bin/bash", join(root, "scripts", "dev.sh"), "watch"], {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", MAIPAI_DEV_ROOT: root, MAIPAI_DEV_WATCH_SECONDS: "1", MAIPAI_HOST_GUARD_STATE_DIR: guard, MAIPAI_DEV_RESTART_CMD: `echo restarted > '${marker}'` },
  });
  try {
    await Bun.sleep(1500);
    expect(existsSync(marker)).toBe(false);
    writeFileSync(join(guard, "fsevents-restarted"), JSON.stringify({ version: 1, restarted_at: 2000 }));
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(100);
    expect(readFileSync(marker, "utf8").trim()).toBe("restarted");
    expect(await watch.exited).toBe(0);
    expect(readFileSync(join(state, "watch.log"), "utf8")).toContain("file-event service was restarted by the host guard");
    // The file changed during the restart window, which the recovery check looks for after the hub is back.
    expect(readFileSync(join(state, "fsevents-probe", "window.txt"), "utf8").trim()).toBe("2000");
  } finally { vite.kill(); watch.kill(); }
}, 20_000);
