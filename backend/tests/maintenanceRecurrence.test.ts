import { describe, expect, test } from "bun:test";
import { maintenanceOccurrence, validateMaintenanceRecurrence } from "@/lib/maintenanceRecurrence";

const once = { starts_at: "2026-10-10T10:00:00Z", ends_at: "2026-10-10T12:00:00Z" };
const daily = { ...once, rrule: "FREQ=DAILY" };
const at = (iso: string) => new Date(iso);

describe("maintenanceOccurrence, one-off window", () => {
  test("is scheduled before it starts", () => {
    expect(maintenanceOccurrence(once as never, at("2026-10-10T09:59:59Z"), "UTC")).toEqual({ ...once, status: "scheduled" });
  });
  test("is in progress from the start until the end", () => {
    expect(maintenanceOccurrence(once as never, at("2026-10-10T10:00:00Z"), "UTC").status).toBe("in_progress");
    expect(maintenanceOccurrence(once as never, at("2026-10-10T11:59:59Z"), "UTC").status).toBe("in_progress");
  });
  test("is completed at the end time and after", () => {
    expect(maintenanceOccurrence(once as never, at("2026-10-10T12:00:00Z"), "UTC").status).toBe("completed");
  });
  test("cancelled wins over the clock", () => {
    const cancelled = { ...once, cancelled_at: "2026-10-01T00:00:00Z" };
    expect(maintenanceOccurrence(cancelled as never, at("2026-10-10T11:00:00Z"), "UTC")).toEqual({ ...once, status: "cancelled" });
  });
});

describe("maintenanceOccurrence, recurring window", () => {
  test("is in progress during today's occurrence", () => {
    expect(maintenanceOccurrence(daily as never, at("2026-10-12T11:00:00Z"), "UTC")).toEqual({
      starts_at: "2026-10-12T10:00:00.000Z",
      ends_at: "2026-10-12T12:00:00.000Z",
      status: "in_progress",
    });
  });
  test("is scheduled for tomorrow after today's occurrence ended", () => {
    expect(maintenanceOccurrence(daily as never, at("2026-10-12T13:00:00Z"), "UTC")).toEqual({
      starts_at: "2026-10-13T10:00:00.000Z",
      ends_at: "2026-10-13T12:00:00.000Z",
      status: "scheduled",
    });
  });
  test("is completed on the last occurrence once the until date has passed", () => {
    const limited = { ...daily, until: "2026-10-11" };
    expect(maintenanceOccurrence(limited as never, at("2026-10-15T13:00:00Z"), "UTC")).toEqual({
      starts_at: "2026-10-11T10:00:00.000Z",
      ends_at: "2026-10-11T12:00:00.000Z",
      status: "completed",
    });
  });
  test("cancelled keeps the most recent occurrence", () => {
    const cancelled = { ...daily, cancelled_at: "2026-10-01T00:00:00Z" };
    expect(maintenanceOccurrence(cancelled as never, at("2026-10-12T13:00:00Z"), "UTC")).toEqual({
      starts_at: "2026-10-12T10:00:00.000Z",
      ends_at: "2026-10-12T12:00:00.000Z",
      status: "cancelled",
    });
  });
});

describe("validateMaintenanceRecurrence", () => {
  test("accepts a window with no rule and a valid rule", () => {
    expect(validateMaintenanceRecurrence(once as never, "UTC")).toBeUndefined();
    expect(validateMaintenanceRecurrence(daily as never, "UTC")).toBeUndefined();
  });
  test("throws for an invalid rule", () => {
    expect(() => validateMaintenanceRecurrence({ ...once, rrule: "FREQ=NOPE" } as never, "UTC")).toThrow();
  });
});
