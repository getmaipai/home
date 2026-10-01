import { beforeEach, describe, expect, test } from "bun:test";
import { __resetServiceHealthForTests, recordServiceOutcome, serviceDetail, serviceState } from "@/lib/serviceHealth";

beforeEach(() => __resetServiceHealthForTests());

describe("outside service request health", () => {
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
});
