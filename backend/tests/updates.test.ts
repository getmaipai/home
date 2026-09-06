import { describe, expect, test, beforeEach, mock } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { checkForAppUpdate, cachedUpdateProjection, isNewerVersion } from "@/lib/updates";
import { listPending } from "@/lib/notifications";
import { sqlite } from "@/db";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

function mockGitHubRelease(response: { status: number; body: unknown }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(response.body), { status: response.status }))) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("isNewerVersion()", () => {
  test("a genuinely newer patch/minor/major version is newer", () => {
    expect(isNewerVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "1.0.0")).toBe(true);
  });

  test("numeric comparison, not lexicographic - 0.9.0 vs 0.10.0", () => {
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(false);
  });

  test("an identical version is never newer", () => {
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
  });

  test("an older version is never newer", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(false);
  });

  test("an unparseable tag on either side is never newer", () => {
    expect(isNewerVersion("0.1.0", "not-a-version")).toBe(false);
    expect(isNewerVersion("not-a-version", "0.2.0")).toBe(false);
  });

  test("a leading v is accepted", () => {
    expect(isNewerVersion("0.1.0", "v0.2.0")).toBe(true);
  });

  test("a prerelease-suffixed tag is unparseable, never treated as newer", () => {
    expect(isNewerVersion("0.1.0", "v0.2.0-rc.1")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0-beta")).toBe(false);
  });
});

describe("checkForAppUpdate()", () => {
  test("a real newer release is recorded and notifies adults", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };

    const restore = mockGitHubRelease({
      status: 200,
      body: { tag_name: "v9.9.9", html_url: "https://github.com/getmaipai/home/releases/tag/v9.9.9", body: "a great release", assets: [] },
    });
    try {
      const projection = await checkForAppUpdate();
      expect(projection.latest).toBe("v9.9.9");
      expect(projection.blockedBy).toBeTruthy();
      expect(projection.error).toBeNull();
    } finally {
      restore();
    }

    expect(listPending(toPersonRow(person.id)).some((n) => n.text.includes("9.9.9"))).toBe(true);
  });

  test("the same still-unapplied release never notifies twice", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };

    const restore = mockGitHubRelease({
      status: 200,
      body: { tag_name: "v9.9.9", html_url: "https://example.com", body: "a great release", assets: [] },
    });
    try {
      await checkForAppUpdate();
      await checkForAppUpdate();
    } finally {
      restore();
    }

    expect(listPending(toPersonRow(person.id)).filter((n) => n.text.includes("9.9.9"))).toHaveLength(1);
  });

  test("a genuinely newer release after that notifies again", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };

    const restoreFirst = mockGitHubRelease({
      status: 200,
      body: { tag_name: "v9.9.9", html_url: "https://example.com", body: "first", assets: [] },
    });
    try {
      await checkForAppUpdate();
    } finally {
      restoreFirst();
    }
    const restoreSecond = mockGitHubRelease({
      status: 200,
      body: { tag_name: "v9.9.10", html_url: "https://example.com", body: "second", assets: [] },
    });
    try {
      await checkForAppUpdate();
    } finally {
      restoreSecond();
    }

    expect(listPending(toPersonRow(person.id)).some((n) => n.text.includes("9.9.10"))).toBe(true);
  });

  test("no release published yet (404) is recorded as informational, not an error notification", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };

    const restore = mockGitHubRelease({ status: 404, body: { message: "Not Found" } });
    try {
      const projection = await checkForAppUpdate();
      expect(projection.latest).toBeNull();
      expect(projection.error).toContain("no release");
    } finally {
      restore();
    }

    expect(listPending(toPersonRow(person.id))).toHaveLength(0);
  });

  test("a network failure is recorded, never thrown", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error("network unreachable"))) as unknown as typeof fetch;
    try {
      const projection = await checkForAppUpdate();
      expect(projection.error).toContain("network unreachable");
      expect(projection.latest).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rapid repeated checks are rate-limited rather than hammering GitHub", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ tag_name: "v0.1.1", html_url: "https://example.com", body: "", assets: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      for (let i = 0; i < 5; i++) {
        await checkForAppUpdate();
      }
      const limited = await checkForAppUpdate();
      expect(limited.error).toContain("too recently");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toBe(5);
  });

  test("cachedUpdateProjection() reads back the last real check without calling GitHub again", async () => {
    const restore = mockGitHubRelease({
      status: 200,
      body: { tag_name: "v0.5.0", html_url: "https://example.com", body: "notes", assets: [] },
    });
    try {
      await checkForAppUpdate();
    } finally {
      restore();
    }

    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const cached = cachedUpdateProjection();
      expect(calls).toBe(0);
      expect(cached.latest).toBe("v0.5.0");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("GET/POST /api/updates", () => {
  test("any signed-in person can read the cached projection", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/updates");
    expect(res.status).toBe(200);
  });

  test("an adult without backups.run cannot force a fresh check", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });
    expect((await adultClient.post("/api/updates/check", {})).status).toBe(403);
  });

  test("owner/admin can force a fresh check", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const restore = mockGitHubRelease({ status: 404, body: {} });
    try {
      const res = await owner.post("/api/updates/check", {});
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
  });
});
