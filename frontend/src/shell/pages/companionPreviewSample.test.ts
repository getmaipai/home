import { expect, test } from "bun:test";
import { companionPreviewSample } from "@/shell/pages/companionPreviewSample";

test("companion sample data is deterministic and stays within phase zero bounds", () => {
  const first = companionPreviewSample("lively-child");
  expect(companionPreviewSample("lively-child")).toEqual(first);
  expect(["Working", "Idle", "Needs approval"]).toContain(first.status);
  expect(first.tasks).toBeGreaterThanOrEqual(0);
  expect(first.tasks).toBeLessThanOrEqual(3);
  expect(first.activities.length).toBeGreaterThan(0);
  expect(first.activities.every((activity) => activity.detail.startsWith("Completed ·") || activity.detail.startsWith("Scheduled ·"))).toBe(true);
});
