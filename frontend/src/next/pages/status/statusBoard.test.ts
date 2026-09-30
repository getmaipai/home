import { describe, expect, test } from "bun:test";
import { formatMaintenanceRange } from "@/next/pages/status/statusBoardFormat";

describe("formatMaintenanceRange", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const zone = "America/New_York";

  test("formats a same-day range in the local time zone", () => {
    expect(formatMaintenanceRange("2026-09-30T21:00:00Z", "2026-09-30T22:00:00Z", now, zone)).toBe("Today, 5:00 to 6:00 PM");
  });

  test("formats an overnight range", () => {
    expect(formatMaintenanceRange("2026-10-01T03:00:00Z", "2026-10-01T05:30:00Z", now, zone)).toBe("Tonight, 11:00 PM to 1:30 AM");
  });

  test("formats tomorrow and a later date", () => {
    expect(formatMaintenanceRange("2026-10-01T18:00:00Z", "2026-10-01T19:00:00Z", now, zone)).toBe("Tomorrow, 2:00 to 3:00 PM");
    expect(formatMaintenanceRange("2026-10-04T13:00:00Z", "2026-10-04T16:00:00Z", now, zone)).toBe("Oct 4, 9:00 AM to 12:00 PM");
  });
});
