import { describe, expect, test } from "bun:test";
import { spawnProcessGroup, terminateProcessGroup } from "../scripts/train/processGroup";
import { reserveFreePort } from "./fixtures/reserveFreePort";

describe("training process groups", () => {
  test("terminating the group leaves no engine listener", async () => {
    const port = reserveFreePort();
    const proc = spawnProcessGroup([
      "bun",
      "-e",
      `Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1000);`,
    ]);
    try {
      const deadline = Date.now() + 5_000;
      let listening = false;
      while (Date.now() < deadline) {
        listening = await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false);
        if (listening) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(listening).toBe(true);
      await terminateProcessGroup(proc.pid, proc.exited);
      expect(await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false)).toBe(false);
      const listeners = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "ignore" });
      expect(listeners.stdout.toString().trim()).toBe("");
    } finally {
      if (proc.exitCode === null) await terminateProcessGroup(proc.pid, proc.exited);
    }
  });
});
