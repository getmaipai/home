import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";
import { installRunTempRoot } from "./runTemp";

function makeOldDirectory(parent: string, name: string): string {
  const path = join(parent, name);
  mkdirSync(path);
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  utimesSync(path, old, old);
  return path;
}

describe("run temp root", () => {
  test("sweeps only old directories with dead run pids and preserves the new root", () => {
    const parent = mkdtempSync(join(tmpdir(), "maipai-run-temp-test-"));
    const dead = makeOldDirectory(parent, "maipai-run-2147483647-stale");
    const live = makeOldDirectory(parent, `maipai-run-${process.pid}-live`);
    const young = join(parent, "maipai-run-2147483647-young");
    mkdirSync(young);
    const nonmatching = makeOldDirectory(parent, "maipai-other-2147483647-stale");
    const youngTime = new Date();
    utimesSync(young, youngTime, youngTime);

    const previousRoot = process.env.MAIPAI_RUN_TEMP_ROOT;
    const previousTmpdir = process.env.TMPDIR;
    const previousTmp = process.env.TMP;
    const previousTemp = process.env.TEMP;
    process.env.MAIPAI_RUN_TEMP_SWEEP_MINUTES = "120";
    delete process.env.MAIPAI_RUN_TEMP_ROOT;
    let root = "";
    try {
      root = installRunTempRoot(parent);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(live)).toBe(true);
      expect(existsSync(young)).toBe(true);
      expect(existsSync(nonmatching)).toBe(true);
      expect(existsSync(root)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
      if (previousRoot === undefined) delete process.env.MAIPAI_RUN_TEMP_ROOT;
      else process.env.MAIPAI_RUN_TEMP_ROOT = previousRoot;
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
      if (previousTmp === undefined) delete process.env.TMP;
      else process.env.TMP = previousTmp;
      if (previousTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = previousTemp;
      delete process.env.MAIPAI_RUN_TEMP_SWEEP_MINUTES;
    }
  });

  test("removes its root when a process exits with an error", () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const child = spawnSync(process.execPath, ["-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path"); const root = process.env.MAIPAI_RUN_TEMP_ROOT; const nested = fs.mkdtempSync(path.join(os.tmpdir(), "maipai-regression-")); fs.writeFileSync(path.join(nested, "marker"), "created"); console.log(JSON.stringify({ root, nested })); process.exit(7);`], { encoding: "utf8" });
    const result = JSON.parse(child.stdout.trim()) as { root: string; nested: string };

    expect(child.status).toBe(7);
    expect(result.root).toContain("maipai-run-");
    expect(result.nested.startsWith(result.root)).toBe(true);
    expect(existsSync(result.root)).toBe(false);
  });

  // process.execPath, not "bun" from PATH: a wrapper on PATH (such as a shell shim for `bun -e`) would take the SIGTERM instead of the process under test.
  test("removes its root when a process receives SIGTERM", async () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const marker = join(process.env.MAIPAI_RUN_TEMP_ROOT!, `term-child-${crypto.randomUUID()}`);
    const child = Bun.spawn([process.execPath, "-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); fs.writeFileSync(${JSON.stringify(marker)}, process.env.MAIPAI_RUN_TEMP_ROOT); setInterval(() => {}, 1000);`], { stdout: "ignore", stderr: "ignore" });
    for (let attempt = 0; attempt < 200 && !existsSync(marker); attempt++) await Bun.sleep(5);
    const root = readFileSync(marker, "utf8");

    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    expect(existsSync(root)).toBe(false);
  });

  test("removes its root after natural process completion", () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const child = spawnSync(process.execPath, ["-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); const root = process.env.MAIPAI_RUN_TEMP_ROOT; fs.writeFileSync(root + "/marker", "created"); console.log(root);`], { encoding: "utf8" });
    const root = child.stdout.trim();

    expect(child.status).toBe(0);
    expect(root).toContain("maipai-run-");
    expect(existsSync(root)).toBe(false);
  });
});
