import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { __setHostGuardStateDirForTests } from "@/lib/hostGuard";
import { __setHostGuardNotifierForTests, notifyHostGuardRestart, __resetHostGuardNoticeForTests } from "@/lib/hostGuardNotice";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";
import { resetDb } from "./reset-db";

afterEach(async () => { await __drainBackgroundWorkForTests(); resetDb(); __setHostGuardStateDirForTests(null); __resetHostGuardNoticeForTests(); });

test("notifies once for a recorded reboot across Home starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-guard-notice-"));
  __setHostGuardStateDirForTests(dir);
  writeFileSync(join(dir, "last-reboot.txt"), "2026-11-04 12:45:01 user lookup failed\ncapture: 20261104-124400\n");
  const sent: string[] = [];
  __setHostGuardNotifierForTests(async (type, vars) => { sent.push(`${type}:${vars?.text ?? ""}`); });
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    notifyHostGuardRestart();
    await __drainBackgroundWorkForTests();
    notifyHostGuardRestart();
    await __drainBackgroundWorkForTests();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("restarted itself");
    expect(sent[0]).toContain("Open Status");
    expect(db.select().from(settingsValues).all().filter((row) => row.scope === "system" && row.key.includes("host_guard"))).toHaveLength(1);
  } finally { Object.defineProperty(process, "platform", { value: originalPlatform }); rmSync(dir, { recursive: true, force: true }); }
});
