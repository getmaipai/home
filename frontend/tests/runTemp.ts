import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.MAIPAI_RUN_TEMP_ROOT) {
  const root = mkdtempSync(join(tmpdir(), `maipai-run-${process.pid}-`));
  process.env.MAIPAI_RUN_TEMP_ROOT = root;
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      console.error(`[temp cleanup] could not remove ${root}: ${String(error)}`);
    }
  };
  process.once("exit", cleanup);
  process.once("beforeExit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    setImmediate(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    cleanup();
    setImmediate(() => process.exit(143));
  });
}
