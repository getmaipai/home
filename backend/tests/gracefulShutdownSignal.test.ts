import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "maipai-shutdown-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("graceful SIGTERM shutdown order", () => {
  test("waits for engine shutdown before exiting", async () => {
    const markerPath = join(tmp(), "stopped");
    const child = Bun.spawn(
      [process.execPath, "run", join(import.meta.dir, "fixtures/shutdownOrderChild.ts"), markerPath],
      { cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    children.push(child);
    const reader = child.stdout.getReader();
    let output = "";
    while (!output.includes("ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    expect(output).toContain("ready");

    child.kill("SIGTERM");
    const exitCode = await child.exited;
    expect(existsSync(markerPath)).toBe(true);
    expect(exitCode).toBe(0);
  });
});
