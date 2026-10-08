import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";

describe("run temp root", () => {
  test("removes its root when a process exits with an error", () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const child = spawnSync("bun", ["-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path"); const root = process.env.MAIPAI_RUN_TEMP_ROOT; const nested = fs.mkdtempSync(path.join(os.tmpdir(), "maipai-regression-")); fs.writeFileSync(path.join(nested, "marker"), "created"); console.log(JSON.stringify({ root, nested })); process.exit(7);`], { encoding: "utf8" });
    const result = JSON.parse(child.stdout.trim()) as { root: string; nested: string };

    expect(child.status).toBe(7);
    expect(result.root).toContain("maipai-run-");
    expect(result.nested.startsWith(result.root)).toBe(true);
    expect(existsSync(result.root)).toBe(false);
  });

  test("removes its root when a process receives SIGTERM", async () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const marker = join(process.env.MAIPAI_RUN_TEMP_ROOT!, `term-child-${crypto.randomUUID()}`);
    const child = Bun.spawn(["bun", "-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); fs.writeFileSync(${JSON.stringify(marker)}, process.env.MAIPAI_RUN_TEMP_ROOT); setInterval(() => {}, 1000);`], { stdout: "ignore", stderr: "ignore" });
    for (let attempt = 0; attempt < 200 && !existsSync(marker); attempt++) await Bun.sleep(5);
    const root = readFileSync(marker, "utf8");

    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    expect(existsSync(root)).toBe(false);
  });

  test("removes its root after natural process completion", () => {
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("./runTemp.ts", import.meta.url))).href;
    const child = spawnSync("bun", ["-e", `delete process.env.MAIPAI_RUN_TEMP_ROOT; await import(${JSON.stringify(moduleUrl)}); const fs = await import("node:fs"); const root = process.env.MAIPAI_RUN_TEMP_ROOT; fs.writeFileSync(root + "/marker", "created"); console.log(root);`], { encoding: "utf8" });
    const root = child.stdout.trim();

    expect(child.status).toBe(0);
    expect(root).toContain("maipai-run-");
    expect(existsSync(root)).toBe(false);
  });
});
