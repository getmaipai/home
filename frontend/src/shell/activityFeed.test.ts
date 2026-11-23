// ACTIVITY-MERGE-01: Activity and Notifications are one list. A notification becomes a feed row shaped like a job row, and the two sort together.
import { describe, expect, test } from "bun:test";
import { mergeFeed, noticeToFeedItem } from "@/shell/activityFeed";
import type { ActivityItemView, NotificationDeliveryView } from "@/lib/api";

const day = 24 * 3_600_000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const notice = (over: Partial<NotificationDeliveryView> = {}): NotificationDeliveryView => ({ id: "n1", typeId: "repairs.new", level: "time_sensitive", text: "MaiPai Stack is offline", channels: ["in_app"], createdAt: iso(1000), readAt: null, dismissedAt: null, subjectTurnId: null, memoryIds: null, toast: false, ...over } as NotificationDeliveryView);
const job = (over: Partial<ActivityItemView> = {}): ActivityItemView => ({ id: "picture:1", source: "picture", state: "done", title: "A red fox", line: null, percent: null, typicalMinutes: null, href: null, at: iso(5000), ...over });

describe("noticeToFeedItem", () => {
  test("a notification is a done row named notice:<id> with its own words and time", () => {
    expect(noticeToFeedItem(notice())).toMatchObject({ id: "notice:n1", source: "notice", state: "done", title: "MaiPai Stack is offline", notificationId: "n1", percent: null });
  });
  test("an immediate one needs a look", () => {
    expect(noticeToFeedItem(notice({ level: "immediate" })).state).toBe("attention");
  });
  test("a finished clip notice opens the result", () => {
    expect(noticeToFeedItem(notice({ typeId: "video.clip_ready" })).href).toBe("/apps/video/create");
  });
});

describe("mergeFeed", () => {
  test("sorts job rows and notices together, newest first", () => {
    const out = mergeFeed([job({ id: "picture:1", at: iso(5000) }), job({ id: "picture:2", at: iso(100) })], [notice({ id: "n1", createdAt: iso(2000) })]);
    expect(out.map((row) => row.id)).toEqual(["picture:2", "notice:n1", "picture:1"]);
  });
  test("drops dismissed notices and notices older than 30 days, keeps job rows as they are", () => {
    const out = mergeFeed([job()], [notice({ id: "gone", dismissedAt: iso(10) }), notice({ id: "old", createdAt: iso(31 * day) })]);
    expect(out.map((row) => row.id)).toEqual(["picture:1"]);
  });
});
