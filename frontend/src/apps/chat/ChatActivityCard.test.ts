import { describe, expect, test } from "bun:test";
import { pickActivity } from "@/apps/chat/ChatActivityCard";
import { runningNowView, type RunningNowViewer } from "@/shell/runningNow";
import type { HomeJobView } from "@/lib/api";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const viewer: RunningNowViewer = { id: "marlow", band: "adult", admin: false };
const job = (over: Partial<HomeJobView>): HomeJobView => ({ id: "j", kind: "image", state: "running", startedBy: "marlow", forPerson: "marlow", title: "Making a picture of a red fox", createdAt: ago(30), updatedAt: ago(5), actions: [], ...over });
const view = (jobs: HomeJobView[]) => runningNowView({ jobs, viewer, now: NOW });
const none = new Set<string>();

describe("pickActivity (the one calm card above the composer)", () => {
  test("shows nothing when nothing is running, waiting or just finished", () => {
    expect(pickActivity(view([]), undefined, NOW, none)).toBeNull();
    expect(pickActivity(view([job({ state: "done", updatedAt: ago(3600) })]), undefined, NOW, none)).toBeNull();
  });

  test("waiting for you beats running, and the rest fold into 'and n more'", () => {
    const jobs = [job({ id: "r1" }), job({ id: "r2", title: "Making a video" }), job({ id: "w", kind: "chat_ask", state: "waiting_for_you", conversationId: "conv-2", actions: ["open"] })];
    const pick = pickActivity(view(jobs), "conv-1", NOW, none);
    expect(pick).toMatchObject({ kind: "waiting", more: 2 });
    expect(pick?.row.id).toBe("w");
  });

  test("an approval that belongs to the open chat is left to the reply's own card", () => {
    const jobs = [job({ id: "w", kind: "approval", state: "waiting_for_you", conversationId: "conv-1", actions: ["approve", "deny"] })];
    expect(pickActivity(view(jobs), "conv-1", NOW, none)).toBeNull();
    expect(pickActivity(view(jobs), "conv-9", NOW, none)?.kind).toBe("waiting");
  });

  test("a running job shows alone with its Stop", () => {
    const pick = pickActivity(view([job({ actions: ["stop"] })]), undefined, NOW, none);
    expect(pick).toMatchObject({ kind: "running", more: 0 });
    expect(pick?.row.actions).toEqual(["stop"]);
  });

  test("a just-finished job shows for 15 minutes with Open, and a dismissed one stays gone", () => {
    const jobs = [job({ id: "d", state: "done", conversationId: "conv-3", updatedAt: ago(60) })];
    const pick = pickActivity(view(jobs), undefined, NOW, none);
    expect(pick).toMatchObject({ kind: "done" });
    expect(pick?.row.actions).toContain("open");
    expect(pickActivity(view(jobs), undefined, NOW, new Set(["d"]))).toBeNull();
  });
});
