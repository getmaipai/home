import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("local app commands", () => {
  test("starts once, prints URLs, restarts through stop and start, and stops safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "home-lifecycle-"));
    const run = async (command: string) => {
      const child = Bun.spawn([process.execPath, command], { cwd: root, stdout: "pipe", stderr: "pipe" });
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
});
