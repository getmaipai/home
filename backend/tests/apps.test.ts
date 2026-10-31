// APP-KIND-03: the hub serves package apps. The fixture app is the bundled remind package installed
// over itself (an "update to a default package") with app pages and data declared, so the recipe and its
// todo_list block run offline. Nothing here touches the network.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, packageInstalls, packageStatus, settingsValues } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { __resetAppCachesForTests, appImageAllowed, appPackageProblems, appRouteAllowed, appVisibleTo, getAppData } from "@/lib/apps";
import { __resetPackageCachesForTests, loadManifestOnly } from "@/lib/plugins";
import type { PersonRow } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { TestClient } from "./client";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

const ID = "remind";
const VERSION = "9.9.9";

const indexPage = {
  type: "page",
  id: "lists",
  title: "Lists",
  body: [
    { type: "picker", state: "place", label: "Place", leading: [{ value: "current", label: "Current location", needs: "geolocation" }], bind: { source: "package", path: "places" }, item_key_field: "id", item_label_field: "label" },
    { type: "answer_blocks", bind: { source: "package", path: "shopping", params: { place: "$state.place" } }, empty_state: { type: "empty_state", icon: "inbox", text: "Nothing on the list." } },
  ],
};
const morePage = { type: "page", id: "more", title: "More", body: [{ type: "answer_blocks", bind: { source: "package", path: "shopping" } }] };

interface FixtureOptions { pageRoles?: Record<string, string>; minRole?: string; platforms?: string[]; pages?: unknown; extraPage?: boolean; data?: unknown; requires?: string[]; pin?: { pinned_by_default?: boolean; pin_order?: number } }

function installFixtureApp(options: FixtureOptions = {}): string {
  const dir = installedPackageVersionDir(ID, VERSION);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".."), { recursive: true });
  cpSync(join(PACKAGES_DIR, ID), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
  manifest.version = VERSION;
  if (options.minRole) manifest.min_role = options.minRole;
  if (options.platforms) manifest.platforms = options.platforms;
  if (options.requires) manifest.requires = options.requires;
  manifest.contributes = {
    pages: [
      { id: "index", label: "Lists", icon: "list", nav: true, kind: "schema", module: "lists", keywords: ["shopping", "groceries"], ...(options.pin ?? {}), ...(options.pageRoles?.index ? { min_role: options.pageRoles.index } : {}) },
      ...(options.extraPage === false ? [] : [{ id: "more", label: "More", icon: "calendar", nav: true, kind: "schema", module: "more", ...(options.pageRoles?.more ? { min_role: options.pageRoles.more } : {}) }]),
    ],
    data: options.data ?? [
      { id: "shopping", inputs: { action: "show_list", expression: "shopping list" } },
      { id: "places", surface: "weather", rows: "places" },
      { id: "forecast", surface: "weather" },
    ],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "pages", "lists.json"), JSON.stringify(options.pages ?? indexPage));
  writeFileSync(join(dir, "pages", "more.json"), JSON.stringify(morePage));
  db.delete(packageInstalls).where(eq(packageInstalls.packageId, ID)).run();
  db.insert(packageInstalls).values({ packageId: ID, version: VERSION, previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-10-17T00:00:00.000Z" }).run();
  __resetPackageCachesForTests();
  __resetAppCachesForTests();
  return dir;
}

beforeEach(() => resetDb());

/** The fixture app's row in `GET /api/apps`; the bundled Weather app is in the list too and is not what these tests are about. */
async function fixtureApps(client: TestClient): Promise<Array<Record<string, unknown>>> {
  const rows = (await (await client.get("/api/apps")).json()) as Array<Record<string, unknown>>;
  return rows.filter((row) => row.package === ID);
}
afterEach(() => {
  rmSync(installedPackageVersionDir(ID, VERSION), { recursive: true, force: true });
  __resetPackageCachesForTests();
  __resetAppCachesForTests();
});

async function addPlace(client: TestClient, name: string, geo = { lat: 47.6062, lon: -122.3321, precision: "exact", area: "Seattle, Washington", from: "search" }) {
  const response = await client.post("/api/entities", { kind: "place", place_kind: "map", name, scope: "person", geo });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

describe("GET /api/apps", () => {
  test("requires sign-in", async () => {
    expect((await new TestClient().get("/api/apps")).status).toBe(401);
  });

  test("a package without pages is not an app: the bundled set lists only the apps with pages, by label", async () => {
    const { client } = await owner();
    expect((await fixtureApps(client)).map((row) => row.package)).toEqual([]);
    expect(((await (await client.get("/api/apps")).json()) as Array<{ package: string }>).map((row) => row.package)).toEqual(["books", "music", "news", "podcasts", "shows", "videos", "weather"]);
  });

  test("an installed app lists with its launcher fields, sections and route", async () => {
    installFixtureApp();
    const { client } = await owner();
    const rows = await fixtureApps(client);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      package: ID,
      page: "index",
      label: "Lists",
      icon: "list",
      keywords: ["shopping", "groceries"],
      to: `/apps/${ID}`,
      sections: [{ page: "more", label: "More", icon: "calendar" }],
      incognito: "unaffected",
    });
    expect(typeof rows[0]!.description).toBe("string");
    expect(typeof rows[0]!.category).toBe("string");
  });

  // LEFTNAV-APPS-01: the manifest's default pin reaches the shell for everyone the app is visible to.
  test("the bundled Weather app is pinned by default for an owner, a teen and a child", async () => {
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const { client: childClient } = await child(ownerClient);
    for (const client of [ownerClient, teenClient, childClient]) {
      const rows = (await (await client.get("/api/apps")).json()) as Array<{ package: string; pinned_by_default?: boolean; pin_order?: number }>;
      expect(rows.find((row) => row.package === "weather")).toMatchObject({ pinned_by_default: true, pin_order: 10 });
    }
  });

  test("an app that declares no default pin carries neither field; one that does carries both", async () => {
    installFixtureApp();
    const { client } = await owner();
    const plain = (await fixtureApps(client))[0]!;
    expect("pinned_by_default" in plain).toBe(false);
    expect("pin_order" in plain).toBe(false);
    installFixtureApp({ pin: { pinned_by_default: true, pin_order: 3 } });
    expect((await fixtureApps(client))[0]).toMatchObject({ pinned_by_default: true, pin_order: 3 });
  });

  test("a default-pinned app a person's role cannot open is not listed to them", async () => {
    installFixtureApp({ minRole: "admin", pin: { pinned_by_default: true } });
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    expect(await fixtureApps(ownerClient)).toHaveLength(1);
    expect(await fixtureApps(teenClient)).toHaveLength(0);
  });

  test("uninstalling hides it again", async () => {
    installFixtureApp();
    const { client } = await owner();
    const names = async () => (await fixtureApps(client)).map((row) => String(row.package));
    expect(await names()).toEqual([ID]);
    db.delete(packageInstalls).where(eq(packageInstalls.packageId, ID)).run();
    __resetPackageCachesForTests();
    __resetAppCachesForTests();
    expect(await names()).toEqual([]);
  });
});

describe("global search finds apps", () => {
  test("an installed app is found by its keyword and a hidden one is not", async () => {
    installFixtureApp({ minRole: "adult" });
    const { client: ownerClient } = await owner();
    const { client: childClient } = await child(ownerClient);
    const hit = (await (await ownerClient.get("/api/search?q=groceries")).json()) as { groups: Array<{ kind: string; results: Array<{ id: string; href: string }> }> };
    expect(hit.groups.find((g) => g.kind === "app")?.results).toEqual([expect.objectContaining({ id: ID, href: `/apps/${ID}` })]);
    const miss = (await (await childClient.get("/api/search?q=groceries")).json()) as { groups: Array<{ kind: string }> };
    expect(miss.groups.some((g) => g.kind === "app")).toBe(false);
  });
});

describe("who may see an app", () => {
  test("a package above the person's role is absent from the list and 404 on all three routes, per band", async () => {
    installFixtureApp({ minRole: "adult" });
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const { client: childClient } = await child(ownerClient);
    for (const hidden of [teenClient, childClient]) {
      expect(await fixtureApps(hidden)).toEqual([]);
      expect((await hidden.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
      expect((await hidden.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(404);
    }
    expect(await fixtureApps(ownerClient)).toHaveLength(1);
    expect((await ownerClient.get(`/api/plugins/${ID}/pages/index`)).status).toBe(200);
  });

  test("a package a child may use is visible to a child", async () => {
    installFixtureApp({ minRole: "child" });
    const { client: ownerClient } = await owner();
    const { client: childClient } = await child(ownerClient);
    expect(await fixtureApps(childClient)).toHaveLength(1);
    expect((await childClient.get(`/api/plugins/${ID}/pages/index`)).status).toBe(200);
  });

  test("a package whose smoke test disabled it is hidden on all three routes", async () => {
    installFixtureApp();
    db.insert(packageStatus).values({ packageId: ID, status: "disabled", lastSmokeAt: null, smokeOk: false, smokeMessage: "x" }).run();
    const { client } = await owner();
    expect(await fixtureApps(client)).toEqual([]);
    expect((await client.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
    expect((await client.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(404);
  });

  test("a package that does not run on home is hidden", async () => {
    installFixtureApp({ platforms: ["bot"] });
    const { client } = await owner();
    expect(await fixtureApps(client)).toEqual([]);
    expect((await client.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
  });

  test("appVisibleTo refuses a package with a missing required capability, a disabled status or a lower role", () => {
    installFixtureApp();
    const manifest = loadManifestOnly(ID);
    expect(manifest.ok).toBe(true);
    const m = (manifest as { ok: true; value: PackageManifest }).value;
    expect(appVisibleTo({ role: "owner" }, m, { status: "enabled" }, new Set())).toBe(true);
    expect(appVisibleTo({ role: "owner" }, { ...m, requires: ["tts"] }, { status: "enabled" }, new Set(["tts"]))).toBe(false);
    expect(appVisibleTo({ role: "owner" }, m, { status: "disabled" }, new Set())).toBe(false);
    expect(appVisibleTo({ role: "guest" }, { ...m, min_role: "child" }, { status: "enabled" }, new Set())).toBe(false);
  });
});

describe("a page's own min_role (NEWS-00)", () => {
  // The index page binds `places` (a picker) and `shopping`; the More page binds `shopping` only, so `forecast`
  // is bound by no page. The package floor is child; More raises it to teen.
  const placesOnlyIndex = { type: "page", id: "lists", title: "Lists", body: [{ type: "picker", state: "place", label: "Place", bind: { source: "package", path: "places" }, item_key_field: "id", item_label_field: "label" }] };

  test("a page above the viewer is absent from sections and 404 on its page route; a lower page still opens", async () => {
    installFixtureApp({ minRole: "child", pageRoles: { more: "teen" } });
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const { client: childClient } = await child(ownerClient);
    expect((await fixtureApps(childClient))[0]!.sections).toEqual([]);
    expect((await childClient.get(`/api/plugins/${ID}/pages/more`)).status).toBe(404);
    expect((await childClient.get(`/api/plugins/${ID}/pages/index`)).status).toBe(200);
    expect((await fixtureApps(teenClient))[0]!.sections).toEqual([{ page: "more", label: "More", icon: "calendar" }]);
    expect((await teenClient.get(`/api/plugins/${ID}/pages/more`)).status).toBe(200);
  });

  test("an index page above the viewer removes the app from the list and from search, and its pages are 404", async () => {
    installFixtureApp({ minRole: "child", pageRoles: { index: "teen" } });
    const { client: ownerClient } = await owner();
    const { client: childClient } = await child(ownerClient);
    expect(await fixtureApps(childClient)).toEqual([]);
    expect((await childClient.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
    const miss = (await (await childClient.get("/api/search?q=groceries")).json()) as { groups: Array<{ kind: string }> };
    expect(miss.groups.some((g) => g.kind === "app")).toBe(false);
    expect((await fixtureApps(ownerClient))).toHaveLength(1);
  });

  test("a data id is reachable only through a page the viewer may open", async () => {
    installFixtureApp({ minRole: "child", pageRoles: { more: "teen" }, pages: placesOnlyIndex });
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const { client: childClient } = await child(ownerClient);
    // `shopping` is bound only by the teen page.
    expect((await childClient.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(404);
    expect((await teenClient.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(200);
    // `places` is bound by the child-visible index page.
    expect((await childClient.post(`/api/plugins/${ID}/data/places`, {})).status).toBe(200);
  });

  test("a data id and an action used by one open page and one raised page stay open to the lower role", () => {
    const callTo = (action: string) => ({ type: "empty_state", icon: "inbox", text: "None.", action: { call: { target: `/api/plugins/${ID}/actions/${action}` } } });
    const openPage = { type: "page", id: "lists", title: "Lists", body: [{ type: "answer_blocks", bind: { source: "package", path: "shopping" }, empty_state: callTo("follow") }] };
    const dir = installFixtureApp({ minRole: "child", pageRoles: { more: "teen" }, pages: openPage });
    const raised = { type: "page", id: "more", title: "More", body: [{ type: "answer_blocks", bind: { source: "package", path: "shopping" }, empty_state: callTo("follow") }] };
    writeFileSync(join(dir, "pages", "more.json"), JSON.stringify(raised));
    __resetAppCachesForTests();
    const childPerson = { role: "child" } as PersonRow;
    expect(appRouteAllowed(childPerson, ID, "data", "shopping")).toBe(true);
    expect(appRouteAllowed(childPerson, ID, "actions", "follow")).toBe(true);
  });

  test("regression: an action target with a trailing segment or a query still names its action, so a raised page's action stays closed", () => {
    const callTo = (target: string) => ({ type: "page", id: "more", title: "More", body: [{ type: "empty_state", icon: "inbox", text: "None.", action: { call: { target } } }] });
    const dir = installFixtureApp({ minRole: "child", pageRoles: { more: "teen" }, pages: placesOnlyIndex });
    for (const suffix of ["/{id}", "?x=1", "/123"]) {
      writeFileSync(join(dir, "pages", "more.json"), JSON.stringify(callTo(`/api/plugins/${ID}/actions/follow${suffix}`)));
      __resetAppCachesForTests();
      expect(appRouteAllowed({ role: "child" } as PersonRow, ID, "actions", "follow")).toBe(false);
      expect(appRouteAllowed({ role: "teen" } as PersonRow, ID, "actions", "follow")).toBe(true);
    }
  });

  test("regression: with the index page above a child, the app's other pages are 404 too, not only the list", async () => {
    installFixtureApp({ minRole: "child", pageRoles: { index: "teen" } });
    const { client: ownerClient } = await owner();
    const { client: childClient } = await child(ownerClient);
    expect((await childClient.get(`/api/plugins/${ID}/pages/more`)).status).toBe(404);
    expect((await childClient.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(404);
  });

  test("an action named only by a raised page is refused below it; an unused action fails closed; images need one open page", () => {
    const callPage = { type: "page", id: "more", title: "More", body: [{ type: "answer_blocks", bind: { source: "package", path: "shopping" }, empty_state: { type: "empty_state", icon: "inbox", text: "None.", action: { call: { target: `/api/plugins/${ID}/actions/follow` } } } }] };
    const dir = installFixtureApp({ minRole: "child", pageRoles: { more: "teen" }, pages: placesOnlyIndex });
    writeFileSync(join(dir, "pages", "more.json"), JSON.stringify(callPage));
    __resetAppCachesForTests();
    const kid = { role: "child" } as PersonRow;
    const teenPerson = { role: "teen" } as PersonRow;
    expect(appRouteAllowed(kid, ID, "actions", "follow")).toBe(false);
    expect(appRouteAllowed(teenPerson, ID, "actions", "follow")).toBe(true);
    expect(appRouteAllowed(kid, ID, "actions", "unused")).toBe(false); // fails closed: needs the floor of every page
    expect(appRouteAllowed(teenPerson, ID, "actions", "unused")).toBe(true);
    expect(appImageAllowed(kid, ID)).toBe(true);
    expect(appImageAllowed({ role: "guest" } as PersonRow, ID)).toBe(false);
  });

  test("regression: a page that lowers the package floor is refused at install time and the app is not served", async () => {
    const dir = installFixtureApp({ minRole: "adult", pageRoles: { more: "child" } });
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as PackageManifest;
    expect(appPackageProblems(manifest, dir).join(" ")).toContain("a page may only raise the floor");
    const { client: ownerClient } = await owner();
    expect(await fixtureApps(ownerClient)).toEqual([]);
  });

  test("regression: a role the ladder does not know (member) is not a floor", async () => {
    const dir = installFixtureApp({ minRole: "adult" });
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.contributes.pages[0].min_role = "member";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    __resetPackageCachesForTests();
    __resetAppCachesForTests();
    const { client: ownerClient } = await owner();
    expect(await fixtureApps(ownerClient)).toEqual([]);
    expect((await ownerClient.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
  });
});

describe("GET /api/plugins/:id/pages/:pageId", () => {
  test("serves the validated page document; an unknown page is 404", async () => {
    installFixtureApp();
    const { client } = await owner();
    const index = await client.get(`/api/plugins/${ID}/pages/index`);
    expect(index.status).toBe(200);
    expect(await index.json()).toEqual(indexPage);
    expect(await (await client.get(`/api/plugins/${ID}/pages/more`)).json()).toEqual(morePage);
    expect((await client.get(`/api/plugins/${ID}/pages/nope`)).status).toBe(404);
    expect((await client.get(`/api/plugins/no-such-package/pages/index`)).status).toBe(404);
    expect((await new TestClient().get(`/api/plugins/${ID}/pages/index`)).status).toBe(401);
  });

  test("a package whose page binds outside its declared data is not served at all", async () => {
    installFixtureApp({ pages: { type: "page", id: "lists", title: "Lists", body: [{ type: "answer_blocks", bind: { source: "package", path: "elsewhere" } }] } });
    const { client } = await owner();
    expect(await fixtureApps(client)).toEqual([]);
    expect((await client.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
  });
});

describe("POST /api/plugins/:id/data/:dataId", () => {
  test("runs the package's recipe and returns the blocks that pass the filter", async () => {
    installFixtureApp();
    const { client } = await owner();
    await client.post("/api/plugins/remind/run", { action: "add_items", expression: "milk" });
    const res = await client.post(`/api/plugins/${ID}/data/shopping`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { as_of: string; blocks: Array<{ kind: string; producer: string }> };
    expect(typeof body.as_of).toBe("string");
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toMatchObject({ kind: "todo_list", producer: ID });
  });

  test("an unknown data id is 404", async () => {
    installFixtureApp();
    const { client } = await owner();
    expect((await client.post(`/api/plugins/${ID}/data/nope`, {})).status).toBe(404);
  });

  test("rows: the asking person's saved places, and nobody else's", async () => {
    installFixtureApp();
    const { client: ownerClient, row } = await owner();
    const mine = await addPlace(ownerClient, "Cabin");
    const teenClient = await teen(ownerClient);
    const theirs = await addPlace(teenClient, "Skate park");
    // The settings route itself refuses another person's place, so only the asker's own can be saved.
    expect((await ownerClient.put("/api/settings", { scope: `person:${row.id}`, key: "weather.places", value: [mine.id, theirs.id] })).status).toBe(400);
    expect((await ownerClient.put("/api/settings", { scope: `person:${row.id}`, key: "weather.places", value: [mine.id] })).status).toBe(200);
    const res = await ownerClient.post(`/api/plugins/${ID}/data/places`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toEqual([{ id: mine.id, label: "Cabin" }]);
  });

  test("a place id that is not the asker's is refused, and a failed recipe shows only its kind", async () => {
    installFixtureApp();
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const theirs = await addPlace(teenClient, "Skate park");
    const refused = await ownerClient.post(`/api/plugins/${ID}/data/forecast`, { place: theirs.id });
    expect(refused.status).toBe(400);
    const noLocation = await ownerClient.post(`/api/plugins/${ID}/data/forecast`, { place: "current" });
    expect(noLocation.status).toBe(400);
  });
});

describe("the data call and coordinates", () => {
  function person(client: TestClient, row: PersonRow): PersonRow {
    void client;
    return row;
  }

  const okRun = (seen: { hostInputs?: Record<string, unknown>; inputs?: Record<string, unknown> }) =>
    (async (_id: string, _actor: PersonRow, inputs: Record<string, unknown>, _turn?: unknown, options?: { hostInputs?: Record<string, unknown> }) => {
      seen.hostInputs = options?.hostInputs;
      seen.inputs = inputs;
      return { ok: true as const, value: { reply: { text: "Sunny." }, actions: [] } };
    }) as unknown as Parameters<typeof getAppData>[4];

  test("an adult's Current location is rounded to two decimals and never echoed, logged or stored", async () => {
    installFixtureApp();
    const { client, row } = await owner();
    const seen: { hostInputs?: Record<string, unknown>; inputs?: Record<string, unknown> } = {};
    const output: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...args: unknown[]) => void output.push(args.join(" "));
    let result: Awaited<ReturnType<typeof getAppData>>;
    try {
      result = await getAppData(person(client, row), ID, "forecast", { place: "current", current: { lat: 47.60621, lon: -122.33212, area: "Seattle" } }, okRun(seen));
    } finally {
      Object.assign(console, original);
    }
    expect(result.ok).toBe(true);
    expect(seen.hostInputs).toEqual({ latitude: 47.61, longitude: -122.33 });
    expect(seen.inputs?.place).toBe("Seattle");
    expect(JSON.stringify(result)).not.toMatch(/47\.6|122\.3/);
    expect(output.join("\n")).not.toMatch(/47\.6|122\.3/);
    expect(db.select().from(settingsValues).all().every((r) => !r.value.includes("47.6"))).toBe(true);
    expect(db.select().from(entities).all().filter((e) => e.kind === "place")).toHaveLength(0);
  });

  test("a child's call carries one-decimal coordinates", async () => {
    installFixtureApp({ minRole: "child" });
    const { client: ownerClient } = await owner();
    const { client: childClient, row } = await child(ownerClient);
    const seen: { hostInputs?: Record<string, unknown> } = {};
    const result = await getAppData(person(childClient, row), ID, "forecast", { place: "current", current: { lat: 47.60621, lon: -122.33212 } }, okRun(seen));
    expect(result.ok).toBe(true);
    expect(seen.hostInputs).toEqual({ latitude: 47.6, longitude: -122.3 });
  });

  test("a named saved place wins over Current location and sends no coordinates the person did not share", async () => {
    installFixtureApp();
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin", { lat: 40.7128, lon: -74.006, precision: "exact", area: "New York", from: "typed" });
    const seen: { hostInputs?: Record<string, unknown>; inputs?: Record<string, unknown> } = {};
    const result = await getAppData(person(client, row), ID, "forecast", { place: cabin.id, current: { lat: 47.6, lon: -122.3 } }, okRun(seen));
    expect(result.ok).toBe(true);
    expect(seen.inputs?.place).toBe("Cabin");
    expect(seen.hostInputs).toEqual({ latitude: 40.71, longitude: -74.01 });
  });

  test("a recipe failure reports only its kind, never the raw error", async () => {
    installFixtureApp();
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    const failing = (async () => ({ ok: false as const, status: 502 as const, error: "ECONNREFUSED 10.0.0.5:443 secret detail", code: "timeout" })) as unknown as Parameters<typeof getAppData>[4];
    const result = await getAppData(row, ID, "forecast", { place: cabin.id }, failing);
    expect(result).toEqual({ ok: false, status: 502, error: "The lookup took too long.", kind: "timed_out" });
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });

  test("no place at all answers with needs: place, not a failure", async () => {
    installFixtureApp();
    const { client, row } = await owner();
    const result = await getAppData(person(client, row), ID, "forecast", {}, okRun({}));
    expect(result).toMatchObject({ ok: true, value: { blocks: [], needs: "place" } });
  });
});

describe("install-time page validation (appPackageProblems)", () => {
  function problemsFor(mutate: (manifest: Record<string, unknown>, dir: string) => void): string[] {
    const dir = mkdtempSync(join(tmpdir(), "maipai-app-problems-"));
    try {
      installFixtureApp();
      const source = installedPackageVersionDir(ID, VERSION);
      cpSync(source, dir, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
      mutate(manifest, dir);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
      return appPackageProblems(manifest as PackageManifest, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a conforming app has no problems; a package with no pages is not checked", () => {
    expect(problemsFor(() => {})).toEqual([]);
    expect(problemsFor((m) => { m.contributes = {}; })).toEqual([]);
  });

  test("a missing index page, a missing page file and a stray binding are all reported", () => {
    expect(problemsFor((m) => { (m.contributes as { pages: Array<{ id: string }> }).pages[0]!.id = "front"; }).join("\n")).toContain('one page with id "index"');
    expect(problemsFor((_m, dir) => rmSync(join(dir, "pages", "more.json"))).join("\n")).toContain("pages/more.json is missing");
    expect(problemsFor((_m, dir) => writeFileSync(join(dir, "pages", "more.json"), JSON.stringify({ type: "page", id: "more", title: "More", body: [{ type: "answer_blocks", bind: { source: "package", path: "elsewhere" } }] }))).join("\n")).toContain('"elsewhere" is not a contributes.data id');
  });

  test("a settings area that takes a built-in id, another app, or settings that are not the package's own is refused in plain words", () => {
    const area = (m: Record<string, unknown>) => (m.contributes as { settings_area?: Record<string, unknown> }).settings_area!;
    const withArea = (patch: (a: Record<string, unknown>) => void) => problemsFor((m) => {
      (m.contributes as Record<string, unknown>).settings_area = {
        id: "fixture-settings", title: "Fixture", app: `/apps/${ID}`, audience: { min_role: "child" },
        groups: [{ label: "Fixture", sections: ["main"] }],
        sections: [{ id: "main", label: "Main", icon: "map-pin", kind: "keys", cards: [{ label: "Main", group: "fixture", scope: "person" }] }],
      };
      m.config = [{ key: "fixture.thing", scope: "person", selector: "text", default: "", label: "Thing", help: "A thing.", level: "basic", lives_in: "fixture", honoured_by: ["home"] }];
      patch(area(m));
    }).join("\n");
    expect(withArea(() => {})).toBe("");
    expect(withArea((a) => { a.id = "account"; })).toContain('taken by a built-in settings page');
    expect(withArea((a) => { a.id = "users"; })).toContain('taken by a built-in settings page');
    expect(withArea((a) => { a.app = "/apps/other"; })).toContain(`must name its own app, "/apps/${ID}"`);
    expect(withArea((a) => { (a.sections as Array<{ cards: Array<Record<string, unknown>> }>)[0]!.cards[0]!.group = "household"; })).toContain("not one of this package's own settings");
  });

  test("a page that is not valid against the UI schema is reported", () => {
    const out = problemsFor((_m, dir) => writeFileSync(join(dir, "pages", "more.json"), JSON.stringify({ type: "page", id: "more", title: "More", body: [{ type: "answer_blocks", bind: { source: "package", path: "/api/people" } }] })));
    expect(out.join("\n")).toContain("does not match the UI schema");
  });
});
