import { describe, expect, test } from "bun:test";
import { activityItemStatus, makingSignature } from "@/shell/activity";

describe("the Activity entry's dot (PRO-LOOK-01 section 25)", () => {
  test("idle has no mark; each other state has its own level and plain title, and no number", () => {
    expect(activityItemStatus("none")).toBeUndefined();
    expect(activityItemStatus("attention")).toMatchObject({ level: "degraded" });
    expect(activityItemStatus("finished")).toMatchObject({ level: "online" });
    expect(activityItemStatus("running")).toMatchObject({ level: "maintenance" });
    for (const dot of ["attention", "finished", "running"] as const) expect(JSON.stringify(activityItemStatus(dot))).not.toMatch(/\d/);
  });
  test("the list is read again only when a making row appears, changes state or goes", () => {
    const rows = [{ id: "video:1", kind: "video", state: "running" }, { id: "model:1", kind: "model_download", state: "running" }];
    expect(makingSignature(rows)).toBe("video:1:running");
    expect(makingSignature([{ ...rows[0]!, state: "queued" }])).not.toBe(makingSignature(rows));
    expect(makingSignature([])).toBe("");
  });
});
