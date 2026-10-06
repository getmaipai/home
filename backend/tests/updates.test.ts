import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { TestClient } from "./client";
import { restoreDefaultScriptedStack } from "./stackFixture";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { checkForAppUpdate, checkForUpdates, cachedUpdateProjection, isNewerVersion } from "@/lib/updates";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { upsertDeviceState } from "@/lib/deviceStates";
import { listPending } from "@/lib/notifications";
import { sqlite } from "@/db";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PersonRow } from "@/types";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, offlineResponse, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
  const quietStart = (new Date().getHours() + 2) % 24;
  const quietEnd = (quietStart + 1) % 24;
  setHouseholdSettingValue("household.quiet_hours.from", `${String(quietStart).padStart(2, "0")}:00`);
  setHouseholdSettingValue("household.quiet_hours.to", `${String(quietEnd).padStart(2, "0")}:00`);
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

  // Issue #40: cachedUpdateProjection() (every GET /api/updates/) called
  // projectionFromState(row) with no assets argument, always defaulting
  // to [] - app_update_state had no column to read real release assets
  // back from, so they only ever existed in the immediate
  // checkForAppUpdate() response, never on any LATER read.
  test("real release assets persist and are readable on a later, separate read - not just the immediate response", async () => {
    const restore = mockGitHubRelease({
      status: 200,
      body: {
        tag_name: "v9.9.9",
        html_url: "https://example.com",
        body: "a great release",
        assets: [
          { name: "home-macos.zip", browser_download_url: "https://example.com/home-macos.zip", digest: "sha256:abc123" },
          { name: "home-windows.zip", browser_download_url: "https://example.com/home-windows.zip", digest: null },
        ],
      },
    });
    try {
      const projection = await checkForAppUpdate();
      expect(projection.assets).toEqual([
        { name: "home-macos.zip", url: "https://example.com/home-macos.zip", digest: "sha256:abc123" },
        { name: "home-windows.zip", url: "https://example.com/home-windows.zip", digest: null },
      ]);
    } finally {
      restore();
    }

    // The real regression: a completely separate call, simulating a
    // later page load, with no involvement from checkForAppUpdate()'s
    // own in-memory response at all.
    const later = cachedUpdateProjection();
    expect(later.assets).toEqual([
      { name: "home-macos.zip", url: "https://example.com/home-macos.zip", digest: "sha256:abc123" },
      { name: "home-windows.zip", url: "https://example.com/home-windows.zip", digest: null },
    ]);
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
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
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

// HOME-STACK-05: the Stack's own engine/model rows beside Home's own
// release row - null when engines.stack.url is empty (this file's
// tests above, all unmodified).
describe("GET /api/updates, with a configured Stack", () => {
  let fixture: StackFixture;

  afterEach(() => {
    fixture?.stop();
    __resetStackEngineForTests();
    restoreDefaultScriptedStack();
  });

  test("stack is null with no Stack configured", async () => {
    __setStackClientForTests(null);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const emptyLibraryDir = join(process.env.MAIPAI_DATA_DIR!, "updates-empty-reference");
    mkdirSync(emptyLibraryDir, { recursive: true });
    setHouseholdSettingValue("reference.library_dir", emptyLibraryDir);
    const body = (await (await owner.get("/api/updates")).json()) as { stack: unknown; reference: unknown; referenceError: string | null };
    expect(body.stack).toBeNull();
    expect(body.reference).toBeNull();
    expect(body.referenceError).toBeNull();
  });

  test("a fixture engine index makes an update row appear", async () => {
    fixture = startStackFixture({
      "GET /stack/v1/updates": async () =>
        Response.json({ checksEnabled: true, engines: [{ name: "llama-server", installed: "b1", available: "b2", availableKnown: true, lastChecked: "2026-09-20T00:00:00Z", notes: "a note" }], models: { lastChecked: null, entries: [] } }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const body = (await (await owner.get("/api/updates")).json()) as { stack: { engines: Array<{ name: string; installed: string; available: string; availableKnown: boolean; lastChecked: string; notes: string }> } };
    expect(body.stack.engines).toEqual([{ name: "llama-server", installed: "b1", available: "b2", availableKnown: true, lastChecked: "2026-09-20T00:00:00Z", notes: "a note" }]);
  });

  test("a Stack read failure surfaces stackError instead of silently reading as no Stack at all", async () => {
    fixture = startStackFixture({
      "GET /stack/v1/updates": async () => Response.json({ error: "the index is still loading" }, { status: 409 }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const body = (await (await owner.get("/api/updates")).json()) as { stack: unknown; stackError: string | null };
    expect(body.stack).toBeNull();
    expect(body.stackError).toBe("updates model unavailable: the index is still loading");
  });

  test("apply swaps the engine build", async () => {
    fixture = startStackFixture({
      "POST /stack/v1/updates/engines/llama-server/apply": async () => Response.json({ applied: true, tag: "b2", previous: "b1" }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/updates/stack/engines/llama-server/apply", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true, tag: "b2", previous: "b1" });
  });

  test("a scripted failed swap answers with the Stack's own rollback reason, not a guessed cause", async () => {
    fixture = startStackFixture({
      "POST /stack/v1/updates/engines/llama-server/apply": async () => Response.json({ error: "the swap failed and was rolled back to b1" }, { status: 400 }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/updates/stack/engines/llama-server/apply", {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("the swap failed and was rolled back to b1");
  });

  test("rollback goes back to an installed build", async () => {
    fixture = startStackFixture({
      "POST /stack/v1/updates/engines/llama-server/rollback": async (req) => {
        const { tag } = (await req.json()) as { tag: string };
        return Response.json({ ok: true, tag });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/updates/stack/engines/llama-server/rollback", { tag: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tag: "b1" });
  });

  test("sweep and readiness-check both answer, and a non-admin is refused all four", async () => {
    fixture = startStackFixture({
      "POST /stack/v1/storage/sweep": async () => Response.json({ removed: ["sha256:aaaa"] }),
      "POST /stack/v1/check": async () => Response.json({ at: "2026-09-20T00:00:00Z", ok: true, results: [], fitTogether: { ok: true, reason: null }, reason: null, generation: 1 }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const sweepRes = await owner.post("/api/updates/stack/sweep", {});
    expect(sweepRes.status).toBe(200);
    expect(await sweepRes.json()).toEqual({ removed: ["sha256:aaaa"] });

    const checkRes = await owner.post("/api/updates/stack/readiness-check", {});
    expect(checkRes.status).toBe(200);
    expect(await checkRes.json()).toEqual({ at: "2026-09-20T00:00:00Z", ok: true, reason: null });

    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    expect((await adultClient.post("/api/updates/stack/check", {})).status).toBe(403);
    expect((await adultClient.post("/api/updates/stack/engines/llama-server/apply", {})).status).toBe(403);
    expect((await adultClient.post("/api/updates/stack/engines/llama-server/rollback", { tag: "b1" })).status).toBe(403);
    expect((await adultClient.post("/api/updates/stack/sweep", {})).status).toBe(403);
    expect((await adultClient.post("/api/updates/stack/readiness-check", {})).status).toBe(403);
  });

  test("a scripted Stack offline answers 503 with the companion-free plain wording", async () => {
    fixture = startStackFixture({
      "POST /stack/v1/updates/check": async () => offlineResponse("updates", "the stack process is not running"),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/updates/stack/check", {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("updates model unavailable: the Stack is offline");
  });
});


// ROBOT-UPDATES-01: one GitHub call per repo, the Bot's only when a robot
// is paired, and one honest row per paired robot.
describe("robot update rows", () => {
  const HOME_URL = "https://api.github.com/repos/getmaipai/home/releases/latest";
  const BOT_URL = "https://api.github.com/repos/getmaipai/bot/releases/latest";
  const release = (tag: string) => ({ tag_name: tag, html_url: `https://github.com/getmaipai/bot/releases/tag/${tag}`, body: "notes", assets: [] });

  /** A fake GitHub keyed by URL; records every URL asked for. */
  function fakeGitHub(answers: Record<string, { status: number; body: unknown } | "network-error">) {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = mock((input: unknown) => {
      const url = String(input);
      urls.push(url);
      const answer = answers[url];
      if (!answer) return Promise.resolve(new Response("{}", { status: 404 }));
      if (answer === "network-error") return Promise.reject(new Error("connection refused"));
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }) as unknown as typeof fetch;
    return { urls, restore: () => { globalThis.fetch = originalFetch; } };
  }

  async function ownerAndPersonId(): Promise<{ owner: TestClient; personId: string }> {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };
    return { owner, personId: person.id };
  }

  function pairRobot(personId: string, name: string, frame?: { app_version?: string | null; daemon_version?: string | null }): string {
    const { deviceId } = issueDeviceToken(personId, "robot", name);
    if (frame) upsertDeviceState(deviceId, { activity: "idle", muted: false, tracking: false, ...frame });
    return deviceId;
  }

  type RobotsBody = {
    robots: Array<{ id: string; name: string; installed: string | null; latest: string | null; daemonVersion: string | null; updateAvailable: boolean; blockedBy: string | null; lastChecked: string | null }>;
    robotsError: string | null;
    installed: string;
    latest: string | null;
    error: string | null;
  };
  const readRobots = async (owner: TestClient) => (await (await owner.get("/api/updates")).json()) as RobotsBody;

  test("no robot paired: no request to the Bot's releases, and robots is an empty list", async () => {
    const { owner } = await ownerAndPersonId();
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      await checkForUpdates();
      expect(github.urls).toEqual([HOME_URL]);
      const body = await readRobots(owner);
      expect(body.robots).toEqual([]);
      expect(body.robotsError).toBeNull();
    } finally {
      github.restore();
    }
  });

  test("a robot on 0.1.0 with a scripted v0.2.0 Bot release gives an update row that is honestly blocked", async () => {
    const { owner, personId } = await ownerAndPersonId();
    const deviceId = pairRobot(personId, "Reachy", { app_version: "0.1.0", daemon_version: "1.2.3" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      await checkForUpdates();
      expect([...github.urls].sort()).toEqual([BOT_URL, HOME_URL].sort());
    } finally {
      github.restore();
    }
    const body = await readRobots(owner);
    expect(body.robotsError).toBeNull();
    expect(body.robots).toHaveLength(1);
    expect(body.robots[0]).toMatchObject({
      id: deviceId,
      name: "Reachy",
      installed: "0.1.0",
      latest: "v0.2.0",
      daemonVersion: "1.2.3",
      updateAvailable: true,
      blockedBy: "Installing robot updates from Home isn't built yet.",
    });
    expect(body.robots[0]!.lastChecked).toBeString();
  });

  test("a robot on the latest Bot release shows no update and no block", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.2.0", daemon_version: "1.2.3" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      await checkForUpdates();
    } finally {
      github.restore();
    }
    const row = (await readRobots(owner)).robots[0]!;
    expect(row).toMatchObject({ installed: "0.2.0", latest: "v0.2.0", updateAvailable: false, blockedBy: null });
  });

  test("a robot that never reported app_version is shown as unknown and never marked as having an update", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Never reported");
    pairRobot(personId, "Old build", { daemon_version: "1.2.3" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v9.9.9") } });
    try {
      await checkForUpdates();
    } finally {
      github.restore();
    }
    const body = await readRobots(owner);
    expect(body.robots).toHaveLength(2);
    for (const row of body.robots) {
      expect(row.installed).toBeNull();
      expect(row.latest).toBe("v9.9.9");
      expect(row.updateAvailable).toBe(false);
      expect(row.blockedBy).toBeNull();
    }
    expect(body.robots.find((r) => r.name === "Old build")?.daemonVersion).toBe("1.2.3");
  });

  test("a failed Bot check shows in robotsError and leaves Home's own row alone", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.1.0" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.5") }, [BOT_URL]: "network-error" });
    try {
      await checkForUpdates();
    } finally {
      github.restore();
    }
    const body = await readRobots(owner);
    expect(body.robotsError).toContain("connection refused");
    expect(body.robots[0]).toMatchObject({ installed: "0.1.0", latest: null, updateAvailable: false, blockedBy: null });
    expect(body.latest).toBe("v0.1.5");
    expect(body.error).toBeNull();
  });

  test("no Bot release published yet (404) is not an error: robotsError stays null and no update shows", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.1.0" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 404, body: { message: "Not Found" } } });
    try {
      await checkForUpdates();
    } finally {
      github.restore();
    }
    const body = await readRobots(owner);
    expect(body.robotsError).toBeNull();
    expect(body.robots[0]).toMatchObject({ installed: "0.1.0", latest: null, updateAvailable: false, blockedBy: null });
    expect(body.robots[0]!.lastChecked).toBeString();
  });

  test("a failed Home check does not hide a good Bot check", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.1.0" });
    const github = fakeGitHub({ [HOME_URL]: "network-error", [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      await checkForUpdates();
    } finally {
      github.restore();
    }
    const body = await readRobots(owner);
    expect(body.error).toContain("connection refused");
    expect(body.robotsError).toBeNull();
    expect(body.robots[0]!.updateAvailable).toBe(true);
  });

  test("the Bot's check has its own rate limit, so Home's checks never use it up", async () => {
    const { personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.1.0" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      for (let i = 0; i < 6; i++) await checkForUpdates();
      expect(github.urls.filter((u) => u === HOME_URL)).toHaveLength(5);
      expect(github.urls.filter((u) => u === BOT_URL)).toHaveLength(5);
    } finally {
      github.restore();
    }
  });

  test("the existing projection fields are untouched and the new ones are additive", async () => {
    const { owner } = await ownerAndPersonId();
    const body = (await (await owner.get("/api/updates")).json()) as Record<string, unknown>;
    for (const key of ["installed", "latest", "summary", "url", "assets", "channel", "progress", "needs", "blockedBy", "checkedAt", "error", "stack", "stackError", "reference", "referenceError"]) {
      expect(body).toHaveProperty(key);
    }
    expect(body.robots).toEqual([]);
    expect(body.robotsError).toBeNull();
  });

  test("POST /api/updates/check also refreshes the Bot's row when a robot is paired", async () => {
    const { owner, personId } = await ownerAndPersonId();
    pairRobot(personId, "Reachy", { app_version: "0.1.0" });
    const github = fakeGitHub({ [HOME_URL]: { status: 200, body: release("v0.1.0") }, [BOT_URL]: { status: 200, body: release("v0.2.0") } });
    try {
      expect((await owner.post("/api/updates/check", {})).status).toBe(200);
      expect(github.urls).toContain(BOT_URL);
    } finally {
      github.restore();
    }
    expect((await readRobots(owner)).robots[0]!.latest).toBe("v0.2.0");
  });
});
