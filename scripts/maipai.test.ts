import { describe, test, expect } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// MAIPAI-CLI-01: scripts/maipai run for real with stubs for launchctl, systemctl, sudo, curl, pgrep, ps first on PATH.
// The stubs record every call, so these tests never touch a live Home, Stack or launchd.
const MAIPAI = join(import.meta.dir, "maipai");

interface Box { dir: string; bin: string; log: string; state: string; plist: string }

function stub(box: Box, name: string, body: string) {
  const file = join(box.bin, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function makeBox(): Box {
  const dir = mkdtempSync(join(tmpdir(), "maipai-cli-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const box: Box = { dir, bin, log: join(dir, "calls.log"), state: join(dir, "state"), plist: join(dir, "com.maipai.home.plist") };
  mkdirSync(box.state);
  writeFileSync(box.plist, "<plist/>");
  // Each service-manager call is logged; a "stop" removes the engine marker, a "start" makes Home answer.
  for (const name of ["launchctl", "systemctl"]) {
    stub(box, name, `echo "${name} $*" >> "${box.log}"
case "$*" in
  *bootout*|*" stop "*|*"--user stop"*) [ -n "$KEEP_ENGINE" ] || rm -f "${box.state}/engine"; rm -f "${box.state}/home" ;;
  *bootstrap*|*" start "*|*"--user start"*) touch "${box.state}/engine" "${box.state}/home" ;;
  *cat*) exit 0 ;;
esac`);
  }
  stub(box, "sudo", `echo "sudo $*" >> "${box.log}"; if [ "$1" = "-u" ]; then shift 2; fi; exec "$@"`);
  stub(box, "curl", `[ -e "${box.state}/home" ] && echo -n 200 || echo -n 000`);
  stub(box, "pgrep", `case "$*" in
  *install*) [ -e "${box.state}/installing" ] && echo 4242 && exit 0; exit 1 ;;
  *) [ -e "${box.state}/engine" ] && echo 777 && exit 0; exit 1 ;;
esac`);
  stub(box, "ps", `[ -e "${box.state}/engine" ] && echo "2097152 ${box.dir}/root/stack/llama-server"; exit 0`);
  return box;
}

async function run(box: Box, args: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", MAIPAI, ...args], {
    env: {
      ...process.env, PATH: `${box.bin}:${process.env.PATH}`, MAIPAI_OS: extra.MAIPAI_OS ?? "darwin", MAIPAI_ROOT: join(box.dir, "root"),
      MAIPAI_HOME_PLIST: box.plist, MAIPAI_CONSOLE_USER: userInfo().username, MAIPAI_WAIT: "2", MAIPAI_START_WAIT: "2", ...extra,
    },
    stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const calls = existsSync(box.log) ? readFileSync(box.log, "utf8").trim().split("\n").filter(Boolean) : [];
  return { exitCode, stdout, stderr, calls };
}

describe("maipai control command", () => {
  test("stop on macOS stops Home first, then the Stack, and waits for the engines", async () => {
    const box = makeBox();
    try {
      writeFileSync(join(box.state, "engine"), "");
      writeFileSync(join(box.state, "home"), "");
      const r = await run(box, ["stop"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Stopped.");
      const home = r.calls.findIndex((c) => c.includes("bootout system"));
      const stack = r.calls.findIndex((c) => c.includes("bootout gui/") && c.includes("com.maipai.stack"));
      expect(home).toBeGreaterThanOrEqual(0);
      expect(stack).toBeGreaterThan(home);
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("stop fails by name when an engine will not exit, and says what to do", async () => {
    const box = makeBox();
    try {
      writeFileSync(join(box.state, "engine"), "");
      const r = await run(box, ["stop"], { KEEP_ENGINE: "1" });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("did not stop");
      expect(r.stderr).toContain("maipai stop");
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("start brings the Stack up before Home and waits for the health answer", async () => {
    const box = makeBox();
    try {
      const r = await run(box, ["start"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Home is up");
      const stack = r.calls.findIndex((c) => c.includes("bootstrap gui/"));
      const home = r.calls.findIndex((c) => c.includes("bootstrap system"));
      expect(stack).toBeGreaterThanOrEqual(0);
      expect(home).toBeGreaterThan(stack);
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("start says Home did not answer when it never does", async () => {
    const box = makeBox();
    try {
      stub(box, "curl", "echo -n 000");
      const r = await run(box, ["start"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("did not answer");
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("start, stop and restart refuse while an install is running and change nothing", async () => {
    const box = makeBox();
    try {
      writeFileSync(join(box.state, "installing"), "");
      for (const cmd of ["start", "stop", "restart"]) {
        const r = await run(box, [cmd]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("install or upgrade is running");
        expect(r.calls).toEqual([]);
      }
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("start tells a person with no install to run the installer", async () => {
    const box = makeBox();
    try {
      rmSync(box.plist);
      const r = await run(box, ["start"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Run the installer first");
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("status reports both parts and the engine memory without changing anything", async () => {
    const box = makeBox();
    try {
      writeFileSync(join(box.state, "engine"), "");
      writeFileSync(join(box.state, "home"), "");
      const r = await run(box, ["status"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Home:      running");
      expect(r.stdout).toContain("AI engine: running");
      expect(r.stdout).toContain("AI engine memory: 2 GB");
      expect(r.calls).toEqual([]);
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("status on a stopped computer says stopped", async () => {
    const box = makeBox();
    try {
      const r = await run(box, ["status"]);
      expect(r.stdout).toContain("AI engine: stopped");
      expect(r.stdout).toContain("Home:      stopped");
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("Linux uses systemctl for Home and a systemd user unit for the Stack", async () => {
    const box = makeBox();
    try {
      writeFileSync(join(box.state, "engine"), "");
      writeFileSync(join(box.state, "home"), "");
      const r = await run(box, ["stop"], { MAIPAI_OS: "linux" });
      expect(r.exitCode).toBe(0);
      expect(r.calls.some((c) => c.includes("systemctl stop maipai-home.service"))).toBe(true);
      expect(r.calls.some((c) => c.includes("systemctl --user stop maipai-stack.service"))).toBe(true);
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("an unsupported system gets a plain message", async () => {
    const box = makeBox();
    try {
      const r = await run(box, ["status"], { MAIPAI_OS: "freebsd" });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("supports macOS and Linux");
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });

  test("no argument prints usage and exits 0; an unknown word exits 64", async () => {
    const box = makeBox();
    try {
      expect((await run(box, [])).stdout).toContain("usage: maipai");
      expect((await run(box, ["frobnicate"])).exitCode).toBe(64);
    } finally { rmSync(box.dir, { recursive: true, force: true }); }
  });
});
