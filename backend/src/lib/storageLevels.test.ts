import { beforeEach, describe, expect, test } from "bun:test";
import { listIssues, __resetReminderTimersForTests } from "@/lib/issues";
import { __resetDiskLevelForTests, checkDiskFull, checkMissingModelFiles, levelOfDisk } from "@/lib/storage";
import { resetDb } from "../../tests/reset-db";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";

const GB = 1_000_000_000;
const TB18 = 1_800_000_000_000;
const disk = (freeGb: number, total = TB18) => ({ totalBytes: total, freeBytes: freeGb * GB });
const open = () => listIssues().filter((i) => i.source === "storage" && i.key.startsWith("disk_full"));

beforeEach(() => { resetDb(); __resetReminderTimersForTests(); __resetDiskLevelForTests(); __resetStackEngineForTests(); });

describe("disk levels in Home (DISK-GUARD-03)", () => {
  test("47 GB free of 1.8 TB is critical", () => { expect(levelOfDisk(disk(47))).toBe("critical"); });
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
  test("uses Stack volume levels and avoids a duplicate Home item for the same device", async () => {
    const device = 4242;
    __setStackClientForTests({ disk: async () => ({ level: "critical", volumes: [{ path: "/tmp", free_bytes: 1, total_bytes: 1, level: "warn", warn_bytes: 1, critical_bytes: 1 }], missing: [] }) } as never);
    await checkDiskFull(() => ({ ...disk(400), device }));
    expect(open()).toHaveLength(1);
    expect(open()[0]?.key).toContain("disk_full:");
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

describe("missing selected model files (DISK-GUARD-05)", () => {
  test("raises the storage Repairs item from an injected Stack reading, then resolves it when clear", async () => {
    const read = async () => ({ level: "normal" as const, volumes: [], missing: [{ role: "video", model: "video-model", missing_paths: ["/models/video-model/weights"] }] });
    await checkMissingModelFiles(read);
    const issue = listIssues().find((item) => item.source === "storage" && item.key === "model_files_missing");
    expect(issue?.severity).toBe("error");
    expect(issue?.title).toBe("A model part needs repair");
    expect(issue?.detail).not.toContain("video-model");
    expect(issue?.detail).toContain("Install this part again in Settings, Models and storage.");
    expect(issue?.learn_more).toBe("/settings/models");
    await checkMissingModelFiles(async () => ({ level: "normal", volumes: [], missing: [] }));
    expect(listIssues().filter((item) => item.source === "storage" && item.key === "model_files_missing")).toEqual([]);
  });
});
