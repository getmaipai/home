import { describe, expect, test, beforeEach } from "bun:test";
import forge from "node-forge";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetFixHandlersForTests } from "@/lib/issues";
import { __resetHouseholdCaForTests } from "@/lib/householdCa";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetHouseholdCaForTests();
  __resetRateLimiterForTests();
});

describe("GET /api/setup/ca", () => {
  test("is public - no session required", async () => {
    const client = new TestClient();
    const res = await client.get("/api/setup/ca");
    expect(res.status).toBe(200);
  });

  test("returns a real PEM certificate, never a private key, plus a per-platform install hint and a QR payload", async () => {
    const client = new TestClient();
    const res = await client.get("/api/setup/ca");
    const body = (await res.json()) as {
      certificate: string;
      hubName: string;
      installHint: Record<string, string>;
      qrPayload: string | null;
    };
    expect(body.certificate).toContain("BEGIN CERTIFICATE");
    expect(body.certificate).not.toContain("PRIVATE KEY");
    // A real, parseable certificate - not just a string containing the right words.
    expect(() => forge.pki.certificateFromPem(body.certificate)).not.toThrow();
    expect(body.hubName.length).toBeGreaterThan(0);
    expect(Object.keys(body.installHint)).toEqual(["darwin", "windows", "ios", "android", "linux"]);
    expect(body.qrPayload).toContain("/api/setup/ca");
  });

  // A code review (2026-09-06) found this route unthrottled despite
  // spawning a `tailscale status` subprocess on every call - an
  // unauthenticated caller could hammer the hub into spawning
  // subprocesses as fast as it could accept connections.
  test("throttles a caller that exceeds the per-address budget", async () => {
    const client = new TestClient();
    let sawTooMany = false;
    for (let i = 0; i < 15; i++) {
      const res = await client.get("/api/setup/ca");
      if (res.status === 429) {
        sawTooMany = true;
        const body = (await res.json()) as { error: string };
        expect(body.error.length).toBeGreaterThan(0);
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });

  test("also mints a leaf certificate as a side effect, ready for the server to use", async () => {
    const client = new TestClient();
    await client.get("/api/setup/ca");
    const { hasHouseholdLeaf } = await import("@/lib/householdCa");
    expect(hasHouseholdLeaf()).toBe(true);
  });
});
