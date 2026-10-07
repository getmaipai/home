import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { purgeLegacyHubLogs } from "./legacyHubLogPurge";

let directory: string;

afterEach(() => {
  if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true });
});

describe("purgeLegacyHubLogs", () => {
  test("removes only hub.log files and reports their names and byte sizes", () => {
    directory = mkdtempSync(join(tmpdir(), "maipai-hub-log-purge-"));
    const hubLog = "legacy log\n";
    const rotatedHubLog = "rotated log\n";
    writeFileSync(join(directory, "hub.log"), hubLog);
    writeFileSync(join(directory, "hub.log.2026-10-01"), rotatedHubLog);
    writeFileSync(join(directory, "engine.log"), "engine output\n");
    writeFileSync(join(directory, "engine.log.1"), "rotated engine output\n");
    const backupDir = join(directory, "backups");
    mkdirSync(backupDir);
    writeFileSync(join(backupDir, "snapshot.db"), "backup record");

    const result = purgeLegacyHubLogs(directory);

    expect(result).toEqual({
      alreadyPurged: false,
      removed: [
        { name: "hub.log", bytes: Buffer.byteLength(hubLog) },
        { name: "hub.log.2026-10-01", bytes: Buffer.byteLength(rotatedHubLog) },
      ],
    });
    expect(existsSync(join(directory, "hub.log"))).toBe(false);
    expect(existsSync(join(directory, "hub.log.2026-10-01"))).toBe(false);
    expect(existsSync(join(directory, "engine.log"))).toBe(true);
    expect(existsSync(join(directory, "engine.log.1"))).toBe(true);
    expect(existsSync(join(backupDir, "snapshot.db"))).toBe(true);
  });

  test("runs once and leaves later hub.log files alone", () => {
    directory = mkdtempSync(join(tmpdir(), "maipai-hub-log-purge-"));
    purgeLegacyHubLogs(directory);
    const laterLog = join(directory, "hub.log");
    writeFileSync(laterLog, "new logger output\n");

    const result = purgeLegacyHubLogs(directory);

    expect(result).toEqual({ alreadyPurged: true, removed: [] });
    expect(existsSync(laterLog)).toBe(true);
  });
});
