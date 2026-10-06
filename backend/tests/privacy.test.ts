import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { privacyConnections, platformConnections, pluginConnections, offlinePluginNames } from "@/lib/privacy";
import { ROBOT_ASSETS } from "@/lib/robotAssets";
import { listPackageIds, loadPackage } from "@/lib/plugins";
import type { PrivacyConnection } from "@/wire";
import { setHouseholdSettingValue } from "@/lib/settings";

beforeEach(() => {
  resetDb();
});

async function signInAsOwner(client: TestClient) {
  await client.post("/api/auth/setup", { displayName: "Marlow", secret: "1234" });
}

// getmaipai/.github/CLAUDE.md > Privacy architecture: "every product
// keeps a user-tier privacy page with the what-leaves-the-house table:
// each outbound connection, when it happens, what it carries, and who
// receives it." These are the tests that keep that table honest as the
// product grows, which is the only thing that makes it worth having.
describe("the what-leaves-the-house table", () => {
  test("every row answers all four questions the standard asks", () => {
    const rows = privacyConnections();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.destination.length).toBeGreaterThan(0);
      expect(row.when.length).toBeGreaterThan(0);
      expect(row.what.length).toBeGreaterThan(0);
      expect(row.who.length).toBeGreaterThan(0);
      expect(row.retention.length).toBeGreaterThan(0);
    }
  });

  test("row ids are unique, so no connection can hide behind another", () => {
    const ids = privacyConnections().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The rule this enforces is the important one: a package cannot reach
  // the network without a `net:` permission, and a package with one has
  // to say where it goes. A new plugin that fetches something and forgets
  // to declare it fails here rather than silently going missing from the
  // family's privacy page.
  test("every bundled package with network permission declares where it goes", () => {
    for (const id of listPackageIds()) {
      const loaded = loadPackage(id);
      if (!loaded.ok) continue;
      const { manifest } = loaded.value;
      const reachesNetwork = (manifest.permissions ?? []).some((p) => p.startsWith("net:"));
      if (!reachesNetwork) continue;
      expect(
        (manifest.data_sources ?? []).length,
        `${manifest.id} has a net: permission but declares no data_sources`,
      ).toBeGreaterThan(0);
    }
  });

  test("a package that never leaves the house is named as such, not silently absent", () => {
    const offline = offlinePluginNames();
    // Remember and Recall are pure memory operations against the local
    // database. Joke, Trivia, Define and Weather all fetch, and all four
    // appear in the table above instead.
    expect(offline).toContain("Remember");
    expect(offline).toContain("Recall");
    const rowSources = new Set(pluginConnections().map((r) => r.source));
    for (const name of offline) expect(rowSources.has(name)).toBe(false);
  });

  test("the weather package's declared destination reaches the table intact", () => {
    const row = pluginConnections().find((r) => r.id === "weather:open-meteo");
    expect(row).toBeDefined();
    expect(row?.source).toBe("Weather");
    expect(row?.who).toBe("Open-Meteo");
    expect(row?.optIn).toBe(true);
  });
});

// The hub's own downloads are the half nothing else declares, so these
// pin the two claims the page makes about them.
describe("the hub's own connections", () => {
  test("each names the host the downloader actually connects to", () => {
    const byId = new Map(platformConnections().map((r) => [r.id, r]));
    // Home no longer downloads chat weights or llama-server builds.
    expect(byId.has("platform:language-models")).toBe(false);
    expect(byId.has("platform:engine")).toBe(false);
    expect(byId.get("platform:wake-word-models")?.destination).toContain("github.com");
    expect(byId.get("platform:face-vision-models")?.destination).toContain("huggingface.co");
    expect(byId.get("platform:face-vision-models")?.destination).toContain("githubusercontent.com");
    expect(byId.has("platform:text-embedding-model")).toBe(false);
  });

  // ROBOT-UPDATES-01: the daily update check also reads MaiPai Bot's
  // releases when a robot is paired, the same unauthenticated call.
  test("the update check row says Home also reads MaiPai Bot's releases when a robot is paired", () => {
    const row = platformConnections().find((r) => r.id === "platform:update-check");
    expect(row?.destination).toBe("api.github.com");
    expect(row?.what).toContain("MaiPai Bot");
    expect(row?.what).toContain("robot is paired");
  });

  test("robot asset privacy destinations are generated from the pinned manifest URLs", () => {
    const expected = [...new Set(ROBOT_ASSETS.map((asset) => new URL(asset.source_url).hostname))].join(", ");
    const row = platformConnections().find((connection) => connection.id === "platform:robot-assets");
    expect(row?.destination).toBe(expected);
    expect(row?.who).toBe(expected);
  });

  test("Home declares no downloads for the deleted embedding and background engines", () => {
    const byId = new Map(platformConnections().map((r) => [r.id, r]));
    expect(byId.has("platform:background-model")).toBe(false);
    expect(byId.has("platform:text-embedding-model")).toBe(false);
  });

  // Home still downloads Silero for streaming speech endpointing. The
  // Stack owns speech recognition and lists its own model downloads.
  test("Home's voice-activity model download is listed", () => {
    const byId = new Map(platformConnections().map((r) => [r.id, r]));
    const row = byId.get("platform:stt-models");
    expect(row?.destination).toBe("raw.githubusercontent.com");
    expect(row?.when).toContain("cut speech into sentences");
    expect(row?.when).toContain("speech recognition runs on the Stack");
    expect(row?.what).not.toContain("Moonshine");
    expect(row?.what).not.toContain("recognition model");
  });

  // REFERENCE-LIBRARY-01: the kiwix-tools binary download was a real
  // gap left by KIWIX-SIDECAR-01 (kiwix-serve itself sends nothing, but
  // installing it does), found while adding the row for this item's own
  // new download.
  test("kiwix-tools' own install download and reference-library downloads are both listed", () => {
    const byId = new Map(platformConnections().map((r) => [r.id, r]));
    expect(byId.get("platform:kiwix-tools")?.destination).toContain("download.kiwix.org");
    const library = byId.get("platform:reference-library");
    expect(library?.destination).toContain("library.kiwix.org");
    expect(library?.what).toContain("third-party download mirror");
  });

  test("Home declares no downloads for its deleted speech recognizer", () => {
    const ids = platformConnections().map((connection) => connection.id);
    expect(ids).not.toContain("platform:tts-program");
    expect(ids).not.toContain("platform:tts-model");
    expect(ids).not.toContain("platform:tts-voice-files");
    const row = platformConnections().find((connection) => connection.id === "platform:stt-models");
    expect(row).toBeDefined();
    expect(row?.what).not.toContain("Moonshine");
    expect(row?.what).not.toContain("recognition model");
  });

  // Session C step 8 (session-c-brain-and-voice.md): "listed on the
  // privacy page as inbound only" - the one row on this whole page that
  // describes a connection running the opposite direction from every
  // other row (something reaching INTO the hub, not the hub reaching
  // out), so it gets its own test that it says so plainly rather than
  // reading like an outbound row by accident.
  test("the inbound API/Wyoming row is present and honestly describes the reversed direction", () => {
    const row = privacyConnections().find((r) => r.id === "platform:inbound-api");
    expect(row).toBeDefined();
    expect(row!.destination.toLowerCase()).toContain("nothing leaves the house");
    expect(row!.what).toContain("token");
    expect(row!.what.toLowerCase()).toMatch(/inbound|reverse|reaches in|send text or audio to the hub/);
  });

  test("the Home Assistant row says mapped sensor changes stay on the LAN", () => {
    setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
    setHouseholdSettingValue("home.access_token", "test-token");
    const row = privacyConnections().find((r) => r.id === "platform:home-assistant-events");
    expect(row?.what).toContain("sensors or devices you mapped");
    expect(row?.what).toContain("no sensor state is sent to a third party");
  });

  // PrivacyPage.tsx groups inbound rows under its own clearly-labeled
  // section, so a parent does not have to notice the reversed direction
  // buried in prose. A robot's local address-book request is also inbound.
  test("direction structurally marks inbound rows - every other row is outbound", () => {
    const rows = privacyConnections();
    const inbound = rows.filter((r) => r.direction === "inbound");
    expect(inbound.map((r) => r.id)).toEqual(["platform:robot-hub-endpoints", "platform:inbound-api"]);
    for (const row of rows) {
      if (!inbound.includes(row)) expect(row.direction).toBe("outbound");
    }
  });

  test("none of them carries anything the family said or saved", () => {
    for (const row of platformConnections()) {
      expect(row.what.toLowerCase()).toMatch(/nothing anyone in the house said|no recording/);
    }
  });

  // The org's zero-phone-home rule, as a test rather than a promise: no
  // outbound connection may go to anything of ours.
  test("no connection anywhere in the table goes to a MaiPai-operated service", () => {
    for (const row of privacyConnections()) {
      expect(row.destination.toLowerCase()).not.toContain("getmaipai");
      expect(row.who.toLowerCase()).not.toContain("maipai");
    }
  });

  test("the once-a-minute internet check describes its DNS lookup and empty connection", () => {
    const row = platformConnections().find((r) => r.id === "platform:internet-probe");
    expect(row?.when).toContain("once a minute");
    expect(row?.what).toContain("DNS name lookup");
    expect(row?.what).toContain("empty TCP connection");
    expect(row?.destination).toContain("example.com");
    expect(row?.destination).toContain("1.1.1.1:443");
  });
});

describe("GET /api/privacy", () => {
  test("needs a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.get("/api/privacy");
    expect(res.status).toBe(401);
  });

  // Deliberately any household member, not owner/admin: a promise only
  // an admin can check is not a promise to the family.
  test("serves the whole table to any signed-in household member", async () => {
    const client = new TestClient();
    await signInAsOwner(client);
    const res = await client.get("/api/privacy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connections: PrivacyConnection[]; offlinePlugins: string[] };
    expect(body.connections.length).toBe(privacyConnections().length);
    expect(body.connections.some((r) => r.sourceKind === "platform")).toBe(true);
    expect(body.connections.some((r) => r.sourceKind === "plugin")).toBe(true);
    expect(body.offlinePlugins.length).toBeGreaterThan(0);
  });
});
