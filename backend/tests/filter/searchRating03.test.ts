// SEARCH-RATING-03: the engine mode and the host list follow the viewer's web ceiling (RULES.md, Content filter and feature access, C2, C3;
// chat rules 0 and 7; docs/design/search-rating-2026-11-17.md section 4). Everything is offline; lists are loaded the way searchRating02 loads them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "../reset-db";
import { blockListsDir } from "@/lib/paths";
import { blocklistIds, enabledListIds, lockedListIds } from "@/lib/blocklists/policy";
import { __setListsReadyForTests, emptyState, listFilePath, readState, writeState } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests, __resetListDropCountersForTests, checkHost, siteBlocksActive, urlAllowedFor } from "@/lib/blocklists/hostLists";
import { runAsBlockViewer } from "@/lib/blocklists/blockViewer";
import { neededListIds } from "@/lib/blocklists/listSync";
import { invalidatePass } from "@/lib/filter/pass";
import { ceilingOf } from "@/lib/filter/ceiling";
import { resolveSafeSearchLevel, safeSearchModeFor, safeSearchDefaultFor } from "@/lib/safeSearch";
import { hostedSearchAllowed } from "@/lib/hostedSearch";
import { searchAudienceFor, searchFilterApplies } from "@/lib/retrieval/minorRowFloor";
import { getRegistry } from "@/lib/settingsRegistry";
import { setValue, setHouseholdSettingValue } from "@/lib/settings";
import { createHost, __setPageReaderForTests, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests, type PageReadResult } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { useDefaultScriptedStack } from "../stackFixture";
import type { PersonRow } from "@/types";

const now = new Date().toISOString();
function person(id: string, role: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" } as never).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
let admin: PersonRow, adult: PersonRow, teen: PersonRow, child: PersonRow;

function put(id: string, text: string): void {
  const sha = createHash("sha256").update(text).digest("hex");
  const path = listFilePath(id, sha);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const state = emptyState();
  Object.assign(state, readState());
  state.lists[id] = { sha256: sha, entries: text.split("\n").filter(Boolean).length, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: "2026-10-12T00:00:00Z", previousSha256: null } as never;
  writeState(state);
  __resetHostIndexForTests();
}
function loadLists(contents: Record<string, string>): void {
  for (const id of blocklistIds()) put(id, contents[id] ?? "placeholder.invalid\n");
}
const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
const raise = (target: PersonRow, level: string) => { ok(setValue(admin, `person:${target.id}`, "content.ceiling.web", level)); invalidatePass(); };
const lower = (target: PersonRow, level: string) => { ok(setValue(target, `person:${target.id}`, "content.own_ceiling.web", level)); invalidatePass(); };
const bandOf = (p: PersonRow) => (p.role === "child" ? "child" : p.role === "teen" ? "teen" : "adult") as "child" | "teen" | "adult";
const levelFor = (p: PersonRow, stored: unknown = "default", band = bandOf(p)) => resolveSafeSearchLevel(stored, searchAudienceFor(band, p));

beforeEach(() => {
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
  __resetHostIndexForTests();
  __resetListDropCountersForTests();
  __setListsReadyForTests(null);
  admin = person("person-adminaaa", "admin"); adult = person("person-adultaaa", "adult");
  teen = person("person-teenaaaa", "teen"); child = person("person-childaaa", "child");
  invalidatePass();
  loadLists({ "blp-porn": "adult.example.com\nboth.example.com\n", "blp-gambling": "bet.example.com\nboth.example.com\n" });
});
afterEach(() => {
  __setListsReadyForTests(true);
  __setPageReaderForTests(null);
});

describe("the engine mode follows the web ceiling", () => {
  test("the table: G strict; PG, PG-13 and R moderate; X off; the role defaults are unchanged", () => {
    expect([0, 1, 2, 3, 4].map((c) => safeSearchModeFor(c as 0 | 1 | 2 | 3 | 4))).toEqual(["strict", "moderate", "moderate", "moderate", "off"]);
    expect(["child", "teen", "adult"].map((b) => safeSearchDefaultFor(b as "child"))).toEqual(["strict", "moderate", "off"]);
  });
  test("a child at G is strict; a teen at PG-13 is moderate; an adult at X is off", () => {
    expect(levelFor(child)).toBe("strict");
    expect(levelFor(teen)).toBe("moderate");
    expect(levelFor(adult)).toBe("off");
  });
  test("a teen raised to R is moderate; a teen raised to X is off", () => {
    raise(teen, "R");
    expect(levelFor(teen)).toBe("moderate");
    raise(teen, "X");
    expect(levelFor(teen)).toBe("off");
  });
  test("an adult lowered to R by their own ceiling is moderate; lowered to G is strict", () => {
    lower(adult, "R");
    expect(levelFor(adult)).toBe("moderate");
    lower(adult, "G");
    expect(levelFor(adult)).toBe("strict");
  });
  test("a person's own search.safe_search only tightens, at any ceiling", () => {
    expect(levelFor(teen, "strict")).toBe("strict");
    raise(teen, "X");
    expect(levelFor(teen, "strict")).toBe("strict");
    expect(levelFor(teen, "moderate")).toBe("moderate");
    expect(levelFor(teen, "off")).toBe("off"); // already off at X: nothing to loosen
    expect(levelFor(adult, "moderate")).toBe("moderate");
    expect(levelFor(adult, "strict")).toBe("strict");
    expect(levelFor(adult, "off")).toBe("off");
    expect(levelFor(adult, "nonsense")).toBe("off");
    // A person at G cannot go below strict; at R cannot go below moderate.
    expect(levelFor(child, "off")).toBe("strict");
    expect(levelFor(child, "moderate")).toBe("strict");
    raise(child, "R");
    expect(levelFor(child, "off")).toBe("moderate");
  });
  test("an unknown speaker or a shared surface tightens to the turn's band: an actor at X on a child turn searches strict (chat rule 0)", () => {
    raise(teen, "X");
    expect(levelFor(teen, "default", "child")).toBe("strict");
    expect(levelFor(teen, "default", "teen")).toBe("off");
    expect(ceilingOf(searchAudienceFor("child", teen), "search")).toBe(0);
  });
  test("the write rule names the mode, not the age, and follows the web ceiling", () => {
    const refused = setValue(teen, `person:${teen.id}`, "search.safe_search", "off") as { ok: boolean; error?: string };
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("Safe search can't go lower than the mode your content level gives. Pick Default or a stricter level.");
    expect(refused.error).not.toMatch(/\bage\b/i);
    raise(teen, "X");
    ok(setValue(teen, `person:${teen.id}`, "search.safe_search", "off"));
  });
  test("the registry copy equals the pinned spec's, names the level and never the age", () => {
    const def = getRegistry().find((k) => k.key === "search.safe_search")! as unknown as { help: string; copy: { does: string; options: Record<string, string> } };
    const spec = (JSON.parse(readFileSync(`${import.meta.dir}/../../../../commons-tags/spec-spec-v0.1.421/spec/settings/keys.json`, "utf8")) as Array<{ key: string }>).find((k) => k.key === "search.safe_search") as unknown as typeof def | undefined;
    if (spec) expect({ help: def.help, copy: def.copy }).toEqual({ help: spec.help, copy: spec.copy });
    expect(def.help).toContain("Default means the mode your content level gives: strict at G, moderate from PG to R, off at X.");
    expect(JSON.stringify(def)).not.toMatch(/\bage\b/i);
  });
});

describe("the adult-site list follows the web ceiling", () => {
  const listsFor = (p: PersonRow) => enabledListIds(bandOf(p), p.id);
  test("the locked list is on for a child at G, a teen at PG-13 and a teen raised to R; off for a teen raised to X; the other default lists stay", () => {
    expect(listsFor(child)).toContain("blp-porn");
    expect(listsFor(teen)).toContain("blp-porn");
    raise(teen, "R");
    expect(listsFor(teen)).toContain("blp-porn");
    raise(teen, "X");
    expect(listsFor(teen)).not.toContain("blp-porn");
    expect(listsFor(teen)).toContain("blp-gambling");
    expect(checkHost("teen", "https://adult.example.com/x", teen.id)).toBeNull();
    expect(checkHost("teen", "https://bet.example.com/x", teen.id)).toBe("blp-gambling");
  });
  test("a child stays on the list until an admin raises the ceiling", () => {
    expect(checkHost("child", "https://adult.example.com/x", child.id)).toBe("blp-porn");
    raise(child, "X");
    expect(checkHost("child", "https://adult.example.com/x", child.id)).toBeNull();
  });
  test("an adult at X has no list; the admin's deny list still applies; an adult lowered below X has the list", () => {
    expect(listsFor(adult)).toEqual([]);
    expect(checkHost("adult", "https://adult.example.com/x", adult.id)).toBeNull();
    ok(setValue(admin, "household", "search.hosts.deny", "denied.example.com"));
    expect(urlAllowedFor("adult", "https://denied.example.com/x", adult.id)).toBe(false);
    lower(adult, "R");
    expect(listsFor(adult)).toEqual(["blp-porn"]);
    expect(checkHost("adult", "https://adult.example.com/x", adult.id)).toBe("blp-porn");
    expect(urlAllowedFor("adult", "https://adult.example.com/x", adult.id)).toBe(false);
    expect(siteBlocksActive("adult", adult.id)).toBe(true);
  });
  test("the allow list never lifts the locked list for a viewer below X", () => {
    ok(setValue(admin, "household", "search.hosts.allow", "adult.example.com"));
    expect(checkHost("teen", "https://adult.example.com/x", teen.id)).toBe("blp-porn");
    lower(adult, "R");
    expect(checkHost("adult", "https://adult.example.com/x", adult.id)).toBe("blp-porn");
  });
  test("the role-default form (the settings page) is unchanged: a band alone gives child and teen the list, an adult none", () => {
    expect(lockedListIds("child")).toEqual(["blp-porn"]);
    expect(lockedListIds("teen")).toEqual(["blp-porn"]);
    expect(lockedListIds("adult")).toEqual([]);
    expect(lockedListIds("teen", 4)).toEqual([]);
    expect(lockedListIds("adult", 3)).toEqual(["blp-porn"]);
  });
  test("lists not ready: a viewer below X fails closed (an adult lowered too), a viewer at X passes", () => {
    rmSync(blockListsDir, { recursive: true, force: true });
    __resetHostIndexForTests();
    expect(urlAllowedFor("teen", "https://fine.example.com/x", teen.id)).toBe(false);
    expect(urlAllowedFor("adult", "https://fine.example.com/x", adult.id)).toBe(true);
    lower(adult, "R");
    expect(urlAllowedFor("adult", "https://fine.example.com/x", adult.id)).toBe(false);
  });
  test("the household downloads the locked list when an adult lowered their own ceiling", () => {
    expect(neededListIds(new Date())).toContain("blp-porn"); // the teen and the child need it already
    db.delete(people).where(eq(people.id, teen.id)).run();
    db.delete(people).where(eq(people.id, child.id)).run();
    expect(neededListIds(new Date())).toEqual([]);
    lower(adult, "PG-13");
    expect(neededListIds(new Date())).toEqual(["blp-porn"]);
  });
  test("the ambient block viewer picks the person: the same band and no person id read the viewer's ceiling", () => {
    raise(teen, "X");
    expect(runAsBlockViewer(teen.id, () => checkHost("teen", "https://adult.example.com/x"))).toBeNull();
    expect(runAsBlockViewer(child.id, () => checkHost("child", "https://adult.example.com/x"))).toBe("blp-porn");
  });
});

describe("the filter runs by the viewer's web ceiling", () => {
  test("a teen raised to X runs no filter; a teen at PG-13 does; a robot or unknown-speaker turn on a teen at X still does", () => {
    expect(searchFilterApplies("teen", teen)).toBe(true);
    raise(teen, "X");
    expect(searchFilterApplies("teen", teen)).toBe(false);
    expect(searchFilterApplies("child", teen)).toBe(true);
    expect(searchFilterApplies("child", child)).toBe(true);
    expect(searchFilterApplies("teen", null)).toBe(true); // nobody known: the band's role default
  });
  test("an adult runs the filter only below X", () => {
    expect(searchFilterApplies("adult", adult)).toBe(false);
    lower(adult, "R");
    expect(searchFilterApplies("adult", adult)).toBe(true);
  });
  test("the hosted provider never takes a child's or teen's query, at any ceiling (chat rule 7)", () => {
    raise(teen, "X");
    expect(hostedSearchAllowed("teen")).toBe(false);
    expect(hostedSearchAllowed("child")).toBe(false);
    expect(hostedSearchAllowed("adult")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// The search tool and the page read, end to end against a fake SearXNG.
// ---------------------------------------------------------------------------------------------------------------------------------------
function manifest(): PackageManifest {
  return PackageManifest.parse({
    id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test", description: "A test package.", author: "test",
    license: "AGPL-3.0", platforms: ["home"], min_role: "child", incognito: "unaffected", consequential: false, offline: "full", min_app: "0.1.0", tier: 0,
    permissions: ["integration:searxng"],
  });
}
type Found = { text: string; rows: { title: string; url: string | null }[]; pages?: { url: string; text: string }[]; floor_dropped?: number };
let server: ReturnType<typeof Bun.serve> | undefined;
let safesearchSeen: string[] = [];
async function startServer(results: Array<{ title: string; url: string; content: string }>): Promise<void> {
  const config = await Bun.file(`${import.meta.dir}/../fixtures/searxng-config.json`).json();
  safesearchSeen = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => { const u = new URL(req.url); if (u.pathname === "/config") return Response.json(config); safesearchSeen.push(u.searchParams.get("safesearch") ?? ""); return Response.json({ results }); } });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
}
const search = (actor: PersonRow, args: Record<string, unknown> = { query: "heron festival" }, band?: "child" | "teen" | "adult") =>
  (__resetRateLimiterForTests(), __resetSearchCacheForTests(), createHost(actor, manifest(), [], undefined, band ? { band } : {}).integration.call("searxng", "search", args) as Promise<Found>);
const readPage = (actor: PersonRow, url: string, band?: "child" | "teen" | "adult") =>
  (__resetRateLimiterForTests(), createHost(actor, manifest(), [], undefined, band ? { band } : {}).integration.call("searxng", "page.read", { url }) as Promise<unknown>);
const titles = (f: Found) => f.rows.map((r) => r.title);
const RESULTS = [{ title: "Herons", url: "https://marsh.example.com/a", content: "a bird" }, { title: "Adult site", url: "https://adult.example.com/b", content: "a clean sentence" }, { title: "Explicit", url: "https://other.example.com/c", content: "porn videos" }];

describe("the search tool and the page read follow the web ceiling", () => {
  beforeEach(() => {
    useDefaultScriptedStack();
    __resetRateLimiterForTests();
    __resetSearchCacheForTests();
    __resetSearchRotationForTests();
    __resetSearxngEnginesCacheForTests();
    __setListsReadyForTests(true);
  });
  afterEach(() => { server?.stop(true); server = undefined; });

  test("a teen at PG-13: moderate, list on; raised to R: moderate, list on, R rows kept; raised to X: engine off, list lifted, no rater", async () => {
    await startServer([...RESULTS, { title: "Gory", url: "https://gore.example.com/d", content: "a bloody gory scene" }]);
    const base = await search(teen);
    expect(titles(base)).toEqual(["Herons"]);
    expect(safesearchSeen.at(-1)).toBe("1");
    raise(teen, "R");
    const r = await search(teen);
    expect(titles(r)).toEqual(["Herons", "Gory"]);
    expect(safesearchSeen.at(-1)).toBe("1");
    raise(teen, "X");
    const x = await search(teen);
    expect(titles(x)).toEqual(["Herons", "Adult site", "Explicit", "Gory"]);
    expect(safesearchSeen.at(-1)).toBe("0");
  });
  test("a child stays strict with the list on", async () => {
    await startServer(RESULTS);
    expect(titles(await search(child))).toEqual(["Herons"]);
    expect(safesearchSeen.at(-1)).toBe("2");
  });
  test("an adult at X: off, nothing filtered; lowered to R: moderate and the list is on", async () => {
    await startServer(RESULTS);
    expect(titles(await search(adult))).toEqual(["Herons", "Adult site", "Explicit"]);
    expect(safesearchSeen.at(-1)).toBe("0");
    lower(adult, "R");
    expect(titles(await search(adult))).toEqual(["Herons"]);
    expect(safesearchSeen.at(-1)).toBe("1");
  });
  test("a robot or unknown-speaker turn whose actor is a teen at X searches strict with the list on and the raters running (chat rule 0, C3)", async () => {
    raise(teen, "X");
    await startServer(RESULTS);
    expect(titles(await search(teen, undefined, "child"))).toEqual(["Herons"]);
    expect(safesearchSeen.at(-1)).toBe("2");
  });
  test("(F) a robot or unknown-speaker page.read whose actor is a teen at X is refused on an adult-list host; the teen alone reads it", async () => {
    raise(teen, "X");
    const doc: PageReadResult = { type: "document", file_id: "f", url: "https://adult.example.com/b", title: "T", text: "Herons nest in the reeds.", chunks: [], links: [], sections: [] };
    __setPageReaderForTests(async () => ({ ...doc }));
    await expect(readPage(teen, "https://adult.example.com/b", "child")).rejects.toThrow("That page isn't available.");
    // The teen alone (no tighter turn band) is at X: the list is lifted and the page comes back.
    await expect(readPage(teen, "https://adult.example.com/b", "teen")).resolves.toBeDefined();
  });
  test("a lowered adult's page fetch is still blocked on the adult-list host; an adult at X reads it", async () => {
    const doc: PageReadResult = { type: "document", file_id: "f", url: "https://adult.example.com/b", title: "T", text: "Herons nest in the reeds.", chunks: [], links: [], sections: [] };
    __setPageReaderForTests(async () => ({ ...doc }));
    await expect(readPage(adult, "https://adult.example.com/b")).resolves.toBeDefined();
    lower(adult, "R");
    await expect(readPage(adult, "https://adult.example.com/b")).rejects.toThrow("That page isn't available.");
  });
});
