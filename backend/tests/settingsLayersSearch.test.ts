// SETTINGS-LAYERS-01c: a person's own site blocks reach web search, page reads and answer pictures.
// An adult (Marlow) blocks gambling sites for themself; an admin adds a block for a teen (Willow); neither
// touches anyone else, and an adult's cached results are never served to a person with different blocks.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { useDefaultScriptedStack } from "./stackFixture";
import { fixtureWorld, pictureUrl, type FixtureSubject } from "./answerImagesFixture";
import { db } from "@/db";
import { people } from "@/db/schema";
import { blockListsDir } from "@/lib/paths";
import { blocklistIds } from "@/lib/blocklists/policy";
import { __setListsReadyForTests, emptyState, listFilePath, readState, writeState } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests, urlAllowedFor } from "@/lib/blocklists/hostLists";
import { runAsBlockViewer } from "@/lib/blocklists/blockViewer";
import { createHost, __setPageReaderForTests, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests, type PageReadResult } from "@/lib/packageHost";
import { __setAnswerImageDepsForTests, selectAnswerImages } from "@/lib/answerImages/select";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { changeOverrides, changeWebSources } from "@/lib/settingsLayers";
import { neededListIds } from "@/lib/blocklists/listSync";
import { listsReadyForBand } from "@/lib/blocklists/listStore";
import { minorSearchGate } from "@/lib/searchAssist/minorGate";
import { webSourcesFor } from "@/lib/retrieval/webSources";
import type { PersonRow } from "@/types";

function put(id: string, text: string): void {
  const sha = createHash("sha256").update(text).digest("hex");
  const path = listFilePath(id, sha);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const state = emptyState();
  try { Object.assign(state, JSON.parse(readFileSync(join(blockListsDir, "state.json"), "utf-8"))); } catch { /* first list */ }
  state.lists[id] = { sha256: sha, entries: text.split("\n").filter(Boolean).length, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: "2026-10-12T00:00:00Z", previousSha256: null };
  writeState(state);
  __resetHostIndexForTests();
}

function loadLists(gambling: string): void {
  for (const id of blocklistIds()) if (id !== "blp-gambling") put(id, "placeholder.invalid\n");
  put("blp-gambling", gambling);
}

let owner: PersonRow;
let marlow: PersonRow;
let willow: PersonRow;

beforeEach(async () => {
  resetDb();
  useDefaultScriptedStack();
  rmSync(blockListsDir, { recursive: true, force: true });
  __setListsReadyForTests(null);
  __resetHostIndexForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
  await client.post("/api/people", { displayName: "Willow", role: "teen" });
  const by = (name: string) => db.select().from(people).where(eq(people.displayName, name)).get()!;
  owner = by("Sage");
  marlow = by("Marlow");
  willow = by("Willow");
  loadLists("casino.example.com\n");
});

afterEach(() => {
  __setListsReadyForTests(true);
  __setPageReaderForTests(null);
  __setAnswerImageDepsForTests(null);
});

function manifest(): PackageManifest {
  return PackageManifest.parse({
    id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test",
    license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0,
    permissions: ["integration:searxng"],
  });
}

const page = (url: string): PageReadResult => ({ type: "document", file_id: "file-1", url, title: `Title of ${url}`, text: "The Juniper festival is held in June.", chunks: [], links: [], sections: [] });

async function searchAs(actor: PersonRow): Promise<{ rows: { url: string | null }[]; pages?: { url: string }[] }> {
  const config = await Bun.file(`${import.meta.dir}/fixtures/searxng-config.json`).json();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: (req) => new URL(req.url).pathname === "/config" ? Response.json(config) : Response.json({ results: [
      { title: "Casino page", url: "https://casino.example.com/p", content: "A plain snippet." },
      { title: "Festival page", url: "https://news.example.com/p", content: "Another snippet." },
    ] }),
  });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
  __setPageReaderForTests(async (url) => page(url));
  try {
    return (await createHost(actor, manifest()).integration.call("searxng", "search", { query: "juniper festival", read_page: true })) as { rows: { url: string | null }[]; pages?: { url: string }[] };
  } finally {
    server.stop(true);
  }
}

describe("a person's own block reaches web search, page reads and pictures", () => {
  test("an adult's gambling block drops the gambling site from their search, and the owner's cached search is not served to them", async () => {
    const before = await searchAs(owner);
    expect(before.rows.map((r) => r.url)).toContain("https://casino.example.com/p");
    expect(changeOverrides(marlow, marlow.id, "search.blocklists", { add: ["blp-gambling"] }).ok).toBe(true);
    const mine = await searchAs(marlow);
    expect(mine.rows.map((r) => r.url)).not.toContain("https://casino.example.com/p");
    expect(mine.rows.map((r) => r.url)).toContain("https://news.example.com/p");
    expect(mine.pages?.map((p) => p.url) ?? []).not.toContain("https://casino.example.com/p");
    const others = await searchAs(owner);
    expect(others.rows.map((r) => r.url)).toContain("https://casino.example.com/p");
  });

  test("reading a gambling page by address is refused for the person who blocked it and fine for anyone else", async () => {
    __setPageReaderForTests(async (url) => page(url));
    expect(changeOverrides(marlow, marlow.id, "search.blocklists", { add: ["blp-gambling"] }).ok).toBe(true);
    await expect(createHost(marlow, manifest()).integration.call("searxng", "page.read", { url: "https://casino.example.com/p" })).rejects.toThrow();
    const doc = (await createHost(owner, manifest()).integration.call("searxng", "page.read", { url: "https://casino.example.com/p" })) as PageReadResult;
    expect(doc.url).toBe("https://casino.example.com/p");
  });

  test("answer pictures from a site the person blocked are left out", async () => {
    const tower: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Eiffel Tower lead.jpg", files: ["Eiffel Tower lead.jpg", "Eiffel Tower night.jpg", "Eiffel Tower river.jpg", "Eiffel Tower base.jpg"] };
    const world = fixtureWorld([tower], { searchRows: () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70), engines: ["bing images"] }] });
    __setAnswerImageDepsForTests(world.deps);
    const open = await selectAnswerImages({ subject: "Eiffel Tower", actor: marlow, band: "adult", roster: [] });
    expect(open.set?.items.map((i) => i.source.site)).toContain("travel.example.com");
    expect(changeOverrides(marlow, marlow.id, "search.hosts.deny", { add: ["travel.example.com"] }).ok).toBe(true);
    const blocked = await selectAnswerImages({ subject: "Eiffel Tower", actor: marlow, band: "adult", roster: [] });
    expect(blocked.set?.items.map((i) => i.source.site)).not.toContain("travel.example.com");
    const elsewhere = await selectAnswerImages({ subject: "Eiffel Tower", actor: owner, band: "adult", roster: [] });
    expect(elsewhere.set?.items.map((i) => i.source.site)).toContain("travel.example.com");
  });

  test("a block an admin adds for a teen applies to the teen and to nobody else", () => {
    put("blp-drugs", "pills.example.com\n");
    expect(urlAllowedFor("teen", "https://pills.example.com/", willow.id)).toBe(true);
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    expect(urlAllowedFor("teen", "https://pills.example.com/", willow.id)).toBe(false);
    expect(runAsBlockViewer(willow.id, () => urlAllowedFor("teen", "https://pills.example.com/"))).toBe(false);
    expect(urlAllowedFor("teen", "https://pills.example.com/")).toBe(true);
  });

  test("a list only one teen's override turns on is downloaded, and until it loads only that teen's checks fail closed", () => {
    const state = readState();
    delete state.lists["blp-drugs"];
    writeState(state);
    expect(neededListIds(new Date())).not.toContain("blp-drugs");
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    expect(neededListIds(new Date())).toContain("blp-drugs");
    expect(listsReadyForBand("teen", willow.id)).toBe(false);
    expect(listsReadyForBand("teen", null)).toBe(true);
    expect(urlAllowedFor("teen", "https://fine.example.org/", willow.id)).toBe(false);
    expect(urlAllowedFor("teen", "https://fine.example.org/")).toBe(true);
  });

  test("the minor search gate reads the person's own web sources", () => {
    expect(changeWebSources(owner, willow.id, ["searxng"]).ok).toBe(true);
    expect(webSourcesFor("teen", false, willow.id)).toEqual(["searxng"]);
    expect(typeof minorSearchGate).toBe("function");
  });

  test("an adult can lift the household's block for themself, and a custom allow never lifts the adult-site list for a teen", () => {
    setHouseholdSettingValue("search.blocklists", ["blp-gambling"]);
    expect(urlAllowedFor("adult", "https://casino.example.com/", marlow.id)).toBe(false);
    expect(changeOverrides(marlow, marlow.id, "search.blocklists", { remove: ["blp-gambling"] }).ok).toBe(true);
    expect(urlAllowedFor("adult", "https://casino.example.com/", marlow.id)).toBe(true);
    expect(urlAllowedFor("adult", "https://casino.example.com/", owner.id)).toBe(false);
    put("blp-porn", "adult.example.com\n");
    expect(changeOverrides(owner, willow.id, "search.hosts.allow", { add: ["adult.example.com"] }).ok).toBe(false);
    expect(urlAllowedFor("teen", "https://adult.example.com/", willow.id)).toBe(false);
  });
});

describe("web search sources as a user override", () => {
  test("an adult picks their own; a teen cannot; an admin sets a teen's; the global default is untouched", () => {
    expect(webSourcesFor("adult", false, marlow.id)).toEqual(["searxng"]);
    expect(changeWebSources(willow, willow.id, ["searxng"]).ok).toBe(false);
    expect(changeWebSources(owner, willow.id, ["searxng"]).ok).toBe(true);
    expect(changeWebSources(owner, marlow.id, ["searxng"]).ok).toBe(false);
    expect(changeWebSources(marlow, marlow.id, ["nope"]).ok).toBe(false);
    expect(changeWebSources(marlow, marlow.id, ["searxng"]).ok).toBe(true);
    expect(changeWebSources(marlow, marlow.id, null).ok).toBe(true);
    expect(webSourcesFor("adult", false, owner.id)).toEqual(["searxng"]);
  });
});
