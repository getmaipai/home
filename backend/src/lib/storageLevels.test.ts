import { beforeEach, describe, expect, test } from "bun:test";
import { listIssues, __resetReminderTimersForTests } from "@/lib/issues";
import { __resetDiskLevelForTests, checkDiskFull, levelOfDisk } from "@/lib/storage";
import { resetDb } from "../../tests/reset-db";

const GB = 1_000_000_000;
const TB18 = 1_800_000_000_000;
const disk = (freeGb: number, total = TB18) => ({ totalBytes: total, freeBytes: freeGb * GB });
const open = () => listIssues().filter((i) => i.source === "storage" && i.key === "disk_full");

beforeEach(() => { resetDb(); __resetReminderTimersForTests(); __resetDiskLevelForTests(); });

describe("disk levels in Home (DISK-GUARD-03)", () => {
  test("47 GB free of 1.8 TB is critical, the case that went unnoticed", () => { expect(levelOfDisk(disk(47))).toBe("critical"); });
  test("an unreadable disk is normal, never a false alarm", () => {
    expect(levelOfDisk({ totalBytes: Number.POSITIVE_INFINITY, freeBytes: Number.POSITIVE_INFINITY })).toBe("normal");
  });
  test("warning raises a warning item, critical raises an error, plenty resolves it", async () => {
    await checkDiskFull(() => disk(120));
    expect(open().map((i) => i.severity)).toEqual(["warning"]);
    await checkDiskFull(() => disk(40));
    expect(open().map((i) => i.severity)).toEqual(["error"]);
    await checkDiskFull(() => disk(400));
    expect(open()).toEqual([]);
  });
  test("a level clears only a margin above its line", async () => {
    await checkDiskFull(() => disk(40));
    await checkDiskFull(() => disk(60)); // above 54 but inside the 18 GB margin: still an error
    expect(open().map((i) => i.severity)).toEqual(["error"]);
  });
  test("the item's words carry no figures and point at Models and storage", async () => {
    await checkDiskFull(() => disk(40));
    const item = open()[0]!;
    expect(`${item.title} ${item.detail}`).not.toMatch(/\d|GB|memory|RAM/i);
    expect(item.learn_more).toBe("/settings/models");
  });
});
