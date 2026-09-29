import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveFreePort } from "./fixtures/reserveFreePort";

describe("local app commands", () => {
  test("starts once, prints URLs, restarts through stop and start, and stops safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "home-lifecycle-"));
    // SINGLE-INSTANCE-01: app.sh looks at PORT for a hub it does not manage;
    // a free port keeps the family's real hub on 8787 out of this test.
    const env = { ...process.env, PORT: String(reserveFreePort()), MAIPAI_HUB_LOCK_PATH: join(root, "no-hub.lock") };
    const run = async (command: string) => {
      const child = Bun.spawn([process.execPath, command], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(code).toBe(0);
      return out + err;
    };
    try {
      await mkdir(join(root, "scripts"), { recursive: true });
      await mkdir(join(root, "frontend"));
      await mkdir(join(root, "backend/src"), { recursive: true });
      await cp(join(import.meta.dir, "../../scripts/app.sh"), join(root, "scripts/app.sh"));
      const pkg = await Bun.file(join(import.meta.dir, "../../package.json")).json();
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: pkg.scripts }));
      await writeFile(join(root, "frontend/package.json"), JSON.stringify({ scripts: { build: "bun -e 'process.exit(0)'" } }));
      await writeFile(join(root, "backend/src/index.ts"), `
        Bun.serve({ port: 0, fetch: () => new Response("ok") });
        let scheme = "http";
        const report = () => {
          console.log("Home URL: " + scheme + "://localhost:8787");
          console.log("Home URL: https://home.example.com");
          console.log("Home server ready.");
        };
        process.on("SIGUSR1", report);
        process.on("SIGUSR2", () => {
          scheme = "https";
          report();
        });
        report();
      `);
      expect(await run("stop")).toContain("already stopped");
      expect(await run("start")).toContain("https://home.example.com");
      const firstPid = await readFile(join(root, "data/local-app/pid"), "utf8");
      expect(await run("start")).toContain("already running");
      expect(await readFile(join(root, "data/local-app/pid"), "utf8")).toBe(firstPid);
      process.kill(Number(firstPid), "SIGUSR2");
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await readFile(join(root, "data/local-app/app.log"), "utf8")).includes("https://localhost:8787")) break;
        await Bun.sleep(10);
      }
      const refreshed = await run("start");
      expect(refreshed).toContain("https://localhost:8787");
      expect(refreshed).not.toContain("http://localhost:8787");
      const restart = await run("restart");
      expect(restart.indexOf("Home stopped.")).toBeLessThan(restart.indexOf("Home started"));
      expect(await readFile(join(root, "data/local-app/pid"), "utf8")).not.toBe(firstPid);
      expect(await run("stop")).toContain("Home stopped.");
      await writeFile(join(root, "data/local-app/pid"), String(process.pid));
      expect(await run("stop")).toContain("already stopped");
      expect(process.kill(process.pid, 0)).toBe(true);
    } finally {
      await run("stop");
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);

  // SINGLE-INSTANCE-01 (#194): a hub started by hand held the port and
  // `bun stop` answered "already stopped" while `bun start` launched a copy
  // that could not bind. Now all three name the holder and refuse.
  test("stop, start and restart refuse, and name the holder, when a hub they did not start holds the port", async () => {
    const root = await mkdtemp(join(tmpdir(), "home-lifecycle-foreign-"));
    const port = reserveFreePort();
    const foreign = Bun.spawn(
      [process.execPath, "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("x") }); setTimeout(() => {}, 60000);`],
      { cwd: root, stdout: "ignore", stderr: "ignore" },
    );
    const run = async (command: string) => {
      const child = Bun.spawn([process.execPath, command], {
        cwd: root, env: { ...process.env, PORT: String(port), MAIPAI_HUB_LOCK_PATH: join(root, "no-hub.lock") }, stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      return { text: out + err, code };
    };
    try {
      await mkdir(join(root, "scripts"), { recursive: true });
      await mkdir(join(root, "frontend"));
      await mkdir(join(root, "backend/src"), { recursive: true });
      await cp(join(import.meta.dir, "../../scripts/app.sh"), join(root, "scripts/app.sh"));
      const pkg = await Bun.file(join(import.meta.dir, "../../package.json")).json();
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: pkg.scripts }));
      await writeFile(join(root, "frontend/package.json"), JSON.stringify({ scripts: { build: "bun -e 'process.exit(0)'" } }));
      await writeFile(join(root, "backend/src/index.ts"), "throw new Error('must not start');");
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false)) break;
        await Bun.sleep(20);
      }
      for (const command of ["stop", "start", "restart"]) {
        const result = await run(command);
        expect(result.code).not.toBe(0);
        expect(result.text).toContain(`PID ${foreign.pid}`);
        expect(result.text).toContain("did not start");
        expect(result.text).toContain(`kill ${foreign.pid}`);
        expect(result.text).not.toContain("already stopped");
      }
      expect(process.kill(foreign.pid, 0)).toBe(true);
    } finally {
      foreign.kill();
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);

  // SINGLE-INSTANCE-02 (#196): the machine lock finds a hub on a different
  // port and data directory than this checkout's, which the port check
  // alone would miss.
  test("stop, start and restart name a hub found through the machine lock, whatever its port or data directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "home-lifecycle-lock-"));
    const hubPort = reserveFreePort();
    const lockPath = join(root, "state", "hub.lock");
    await mkdir(join(root, "state"), { recursive: true });
    await mkdir(join(root, "other/backend/src"), { recursive: true });
    await writeFile(join(root, "other/backend/src/index.ts"), `Bun.serve({ port: ${hubPort}, fetch: () => new Response("x") }); setTimeout(() => {}, 60000);`);
    const foreign = Bun.spawn([process.execPath, join(root, "other/backend/src/index.ts")], { cwd: join(root, "other/backend"), stdout: "ignore", stderr: "ignore" });
    const run = async (command: string) => {
      // PORT names a different, unused port: only the lock can reveal the hub.
      const child = Bun.spawn([process.execPath, command], {
        cwd: root, env: { ...process.env, PORT: String(reserveFreePort()), MAIPAI_HUB_LOCK_PATH: lockPath }, stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      return { text: out + err, code };
    };
    try {
      await mkdir(join(root, "scripts"), { recursive: true });
      await mkdir(join(root, "frontend"));
      await mkdir(join(root, "backend/src"), { recursive: true });
      await cp(join(import.meta.dir, "../../scripts/app.sh"), join(root, "scripts/app.sh"));
      const pkg = await Bun.file(join(import.meta.dir, "../../package.json")).json();
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: pkg.scripts }));
      await writeFile(join(root, "frontend/package.json"), JSON.stringify({ scripts: { build: "bun -e 'process.exit(0)'" } }));
      await writeFile(join(root, "backend/src/index.ts"), "throw new Error('must not start');");
      await writeFile(lockPath, JSON.stringify({
        pid: foreign.pid, startedAt: Date.now(), port: hubPort, dataDir: "/stray/data", cwd: join(root, "other/backend"),
      }));
      for (const command of ["stop", "start", "restart"]) {
        const result = await run(command);
        expect(result.code).not.toBe(0);
        expect(result.text).toContain(`PID ${foreign.pid}`);
        expect(result.text).toContain("did not start");
        expect(result.text).toContain(`${hubPort}`);
        expect(result.text).toContain("/stray/data");
        expect(result.text).toContain(join(root, "other/backend"));
        expect(result.text).toContain(`kill ${foreign.pid}`);
        expect(result.text).not.toContain("already stopped");
      }
      expect(process.kill(foreign.pid, 0)).toBe(true);
    } finally {
      foreign.kill();
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
});
