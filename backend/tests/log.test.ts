import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { installConsoleFileMirror } from "@/lib/log";
import { logsDir } from "@/lib/paths";

const originalLog = console.log;
afterEach(() => { console.log = originalLog; rmSync(join(logsDir, "hub.log"), { force: true }); });

describe("console file mirror", () => {
  test("continues writing after a simulated hot reload", () => {
    installConsoleFileMirror();
    installConsoleFileMirror();
    console.log("[turn] after reload");
    expect(readFileSync(join(logsDir, "hub.log"), "utf8")).toContain("[turn] after reload");
  });
});
