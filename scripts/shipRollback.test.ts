import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_SH } from "./installFixtures";

// SHIP-ROLLBACK-02. Nothing here touches the real system: maipai-promote runs with id, git, stat, find and sleep shadowed on PATH.
const PROMOTE = join(import.meta.dir, "maipai-promote");
const SHA = "a".repeat(40);

function promoteFixture(archiveFailures: number) {
  const dir = mkdtempSync(join(tmpdir(), "maipai-promote-"));
  const bin = join(dir, "bin"), fix = join(dir, "fix"), root = join(dir, "root");
  mkdirSync(bin); mkdirSync(join(fix, "scripts"), { recursive: true }); mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "data", "hub.db"), "live data");
  writeFileSync(join(fix, "scripts", "install.sh"), `#!/usr/bin/env bash\necho "$*" >> '${join(dir, "install.calls")}'\n`);
  const tool = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  tool("id", "echo 0");
  tool("stat", "echo 0");
  tool("find", "exit 0");
  tool("sleep", `echo "$*" >> '${join(dir, "sleep.calls")}'`);
  tool("git", `
case "$*" in
  *" archive "*)
    n=$(cat '${join(dir, "archive.count")}' 2>/dev/null || echo 0); echo $((n + 1)) > '${join(dir, "archive.count")}'
    if (( n < ${archiveFailures} )); then exit 1; fi
    exec tar -c -C '${fix}' scripts/install.sh ;;
  *" rev-parse "*) echo ${SHA} ;;
  *) exit 0 ;;
esac`);
  const run = () => Bun.spawnSync(["bash", PROMOTE, SHA.slice(0, 7)], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAIPAI_INSTALL_ROOT: root } });
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  return { dir, root, run, read };
}

describe("maipai-promote installer extract", () => {
  test("(a) one failed extract is retried after 2 s and the install continues", () => {
    const f = promoteFixture(1);
    try {
      const r = f.run();
      expect(r.exitCode).toBe(0);
      expect(f.read("sleep.calls").trim()).toBe("2");
      expect(f.read("install.calls")).toContain("--commit");
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test("(b) two failed extracts stop the ship with exit 75, no installer run, no rollback, data untouched", () => {
    const f = promoteFixture(2);
    try {
      const r = f.run();
      expect(r.exitCode).toBe(75);
      expect(r.stderr.toString()).toContain("hub is untouched");
      expect(f.read("install.calls")).toBe("");
      expect(readFileSync(join(f.root, "data", "hub.db"), "utf8")).toBe("live data");
      expect(readdirSync(f.root)).toEqual(["data"]);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test("--rollback <tag> hands the tag to the installed installer; a bad tag is refused", () => {
    const f = promoteFixture(0);
    try {
      mkdirSync(join(f.root, "scripts"));
      writeFileSync(join(f.root, "scripts", "install.sh"), `#!/usr/bin/env bash\necho "$*" >> '${join(f.dir, "install.calls")}'\n`);
      const env = { ...process.env, PATH: `${join(f.dir, "bin")}:${process.env.PATH}`, MAIPAI_INSTALL_ROOT: f.root };
      expect(Bun.spawnSync(["bash", PROMOTE, "--rollback", "sha-0123abc"], { env }).exitCode).toBe(0);
      expect(f.read("install.calls").trim()).toBe("--rollback --to sha-0123abc");
      expect(Bun.spawnSync(["bash", PROMOTE, "--rollback", "$(evil)"], { env }).exitCode).toBe(64);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
});

describe("install.sh rollback data restore", () => {
  const bash = (script: string) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`]);
  function setup() {
    const root = mkdtempSync(join(tmpdir(), "maipai-rb-"));
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", "home.db"), "old data");
    expect(bash(`snapshot_data "${root}" v0.0.9`).exitCode).toBe(0);
    writeFileSync(join(root, "data", "home.db"), "live data");
    return root;
  }

  test("(c) an install that failed before the migrations began does not restore the snapshot", () => {
    const root = setup();
    try {
      const r = bash(`rollback_restore_data "${root}" v0.0.9`);
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("live data");
      expect(readdirSync(root).filter((n) => n.startsWith("data.rolled-back"))).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("an install that got past the migrations marker restores the snapshot and clears the marker", () => {
    const root = setup();
    try {
      expect(bash(`mark_migrations_started "${root}"`).exitCode).toBe(0);
      expect(existsSync(join(root, ".migrations-started"))).toBe(true);
      expect(bash(`rollback_restore_data "${root}" v0.0.9`).exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("old data");
      expect(existsSync(join(root, ".migrations-started"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
