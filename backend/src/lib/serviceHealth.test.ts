import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { __resetServiceHealthForTests, recordServiceOutcome, serviceDetail, serviceState, serviceDiagnostics } from "@/lib/serviceHealth";
import { __setReminderTimingForTests, __resetReminderTimersForTests, listIssues } from "@/lib/issues";
import { recordStatusSample } from "@/lib/statusHistory";
import { __setStatusAppsForTests, __resetStatusAppsForTests, type StatusApp } from "@/lib/appNeeds";
import { resetDb } from "../../tests/reset-db";

beforeEach(() => { resetDb(); __resetServiceHealthForTests(); __resetStatusAppsForTests(); __resetReminderTimersForTests(); __setReminderTimingForTests(10); });

describe("outside service request health", () => {
  test("one transient timeout stays operational if the next real request succeeds", async () => {
    __setStatusAppsForTests([{ id: "weather", name: "Weather", needs: [{ kind: "service", id: "api.example.com", name: "Example", purpose: "Test", required: false }] }]);
    const at = new Date("2026-10-01T12:00:00Z");
    await recordServiceOutcome("api.example.com", { ok: true }, at);
    await recordServiceOutcome("api.example.com", { ok: false, error: new Error("request timed out") }, new Date(at.getTime() + 1000));
    expect(serviceState("service:api-example-com", at.getTime() + 1000)).toBe("operational");
    await recordStatusSample(new Date(at.getTime() + 1000));
    expect(db.select({ state: statusEvents.state }).from(statusEvents).where(eq(statusEvents.component, "service:api-example-com")).all()).toEqual([{ state: "operational" }]);
    await recordServiceOutcome("api.example.com", { ok: true }, new Date(at.getTime() + 2000));
    expect(serviceState("service:api-example-com", at.getTime() + 2000)).toBe("operational");
  });

  test("repeated consecutive server failures degrade, then the third is an outage", async () => {
    const at = new Date("2026-10-01T12:00:00Z");
    await recordServiceOutcome("api.example.com", { ok: true }, at);
    await recordServiceOutcome("api.example.com", { ok: false, status: 503 }, new Date(at.getTime() + 500));
    expect(serviceState("service:api-example-com", at.getTime())).toBe("operational");
    await recordServiceOutcome("api.example.com", { ok: false, status: 503 }, new Date(at.getTime() + 1000));
    expect(serviceState("service:api-example-com", at.getTime() + 1000)).toBe("degraded");
    await recordServiceOutcome("api.example.com", { ok: false, status: 503 }, new Date(at.getTime() + 1500));
    expect(serviceState("service:api-example-com", at.getTime() + 1500)).toBe("outage");
  });

  test("records actual success, then becomes unknown after idle window", async () => {
    const at = new Date("2026-10-01T12:00:00Z");
    await recordServiceOutcome("api.example.com", { ok: true }, at);
    expect(serviceState("service:api-example-com", at.getTime())).toBe("operational");
    expect(serviceDetail("service:api-example-com").last_success_at).toBe(at.toISOString());
    expect(serviceState("service:api-example-com", at.getTime() + 7 * 60 * 60 * 1000)).toBe("unknown");
  });

  test("marks a 429 limited and exposes only its error class", async () => {
    const at = new Date("2026-10-01T12:00:00Z");
    await recordServiceOutcome("api.example.com", { ok: false, status: 429 }, at);
    expect(serviceState("service:api-example-com", at.getTime())).toBe("degraded");
    expect(serviceDetail("service:api-example-com").last_error_class).toBe("http_429");
  });

  test("raises one debounced, reminded admin Repair after a required app service stays down for 60 seconds", async () => {
    const apps: StatusApp[] = [{ id: "fixture-app", name: "Fixture", needs: [{ kind: "service", id: "api.example.com", name: "Example API", purpose: "Load data", required: true }] }];
    __setStatusAppsForTests(apps);
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < 3; i++) await recordServiceOutcome("api.example.com", { ok: false, error: new Error("timed out") }, new Date(now.getTime() + i));
    expect(listIssues().filter((issue) => issue.source === "required-service")).toHaveLength(0);
    await recordStatusSample(new Date(now.getTime() + 59_999));
    expect(listIssues().filter((issue) => issue.source === "required-service")).toHaveLength(0);
    await recordServiceOutcome("api.example.com", { ok: false, error: new Error("timed out") }, new Date(now.getTime() + 60_000));
    await recordStatusSample(new Date(now.getTime() + 60_000));
    const issue = listIssues().find((item) => item.source === "required-service");
    expect(issue).toMatchObject({ severity: "error", title: "Fixture is blocked by Example API", detail: expect.stringContaining("timeout") });
    expect(serviceDiagnostics("service:api-example-com")).toMatchObject({ success_count: 0, failure_count: 4, last_error_class: "timeout" });
    expect(listIssues().find((item) => item.source === "required-service")?.resolved_at).toBeNull();
    await recordStatusSample(new Date(now.getTime() + 61_000));
    expect(listIssues().filter((item) => item.source === "required-service")).toHaveLength(1);
  });

  test("does not page for optional service failures and treats internet blockage as passive", async () => {
    __setStatusAppsForTests([
      { id: "optional", name: "Optional App", needs: [{ kind: "service", id: "optional.example", name: "Optional API", purpose: "Extra", required: false }] },
      { id: "internet", name: "Internet App", needs: [{ kind: "internet", id: "internet", name: "Internet", purpose: "Connect", required: true }] },
    ]);
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < 3; i++) await recordServiceOutcome("optional.example", { ok: false, error: new Error("timed out") }, new Date(now.getTime() + i));
    await recordStatusSample(new Date(now.getTime() + 60_000), "down");
    expect(listIssues().filter((issue) => issue.source === "required-service")).toHaveLength(0);
    expect(listIssues().find((issue) => issue.source === "internet-service")?.severity).toBe("warning");
  });

  test("resolves the Repair and retains diagnostics after recovery", async () => {
    const app: StatusApp = { id: "fixture-app", name: "Fixture", needs: [{ kind: "service", id: "api.example.com", name: "Example API", purpose: "Load data", required: true }] };
    __setStatusAppsForTests([app]);
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < 3; i++) await recordServiceOutcome("api.example.com", { ok: false, error: new Error("timed out") }, new Date(now.getTime() + i));
    await recordServiceOutcome("api.example.com", { ok: false, error: new Error("timed out") }, new Date(now.getTime() + 60_000));
    await recordStatusSample(new Date(now.getTime() + 60_000));
    await recordServiceOutcome("api.example.com", { ok: true }, new Date(now.getTime() + 61_000));
    await recordStatusSample(new Date(now.getTime() + 62_000));
    expect(listIssues({ includeResolved: true }).find((issue) => issue.source === "required-service")).toMatchObject({ resolved_at: expect.any(String), detail: expect.stringContaining("timeout") });
  });
});
