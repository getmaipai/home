import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { privacyConnections, platformConnections, pluginConnections, offlinePluginNames } from "@/lib/privacy";
import { listPackageIds, loadPackage } from "@/lib/plugins";
import type { PrivacyConnection } from "@/wire";

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
    // Derived from modelCatalog/engineCatalog's real pinned URLs, not
    // from a second copy of the host name written into the privacy page.
    expect(byId.get("platform:language-models")?.destination).toContain("huggingface.co");
    expect(byId.get("platform:engine")?.destination).toContain("github.com");
    expect(byId.get("platform:wake-word-models")?.destination).toContain("github.com");
    expect(byId.get("platform:text-embedding-model")?.destination).toContain("huggingface.co");
  });

  // A code review (2026-09-05) found the whole speaking-voice path
  // missing from a page that tells families "if it is not on this list,
  // it does not happen": `uvx pocket-tts serve` installs from PyPI and
  // downloads a voice model, carrying the household's Hugging Face token
  // if they saved one. A credential leaving the house is the single most
  // important row this table can have, so it gets its own test.
  test("the speaking voice's real outbound traffic is listed, token and all", () => {
    const byId = new Map(platformConnections().map((r) => [r.id, r]));
    expect(byId.get("platform:tts-program")?.destination).toContain("pypi.org");
    expect(byId.get("platform:tts-voice-files")?.destination).toContain("huggingface.co");
    const model = byId.get("platform:tts-model");
    expect(model?.destination).toContain("huggingface.co");
    expect(model?.what).toContain("Hugging Face access token");
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
