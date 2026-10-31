// NEWS-00 review (2026-10-17): the independent bypass review of the per-page role floor, kept as permanent tests. A child and a guest
// against every route and variant a raised page owns, the direct /run route, the plugin list, the media-app gate, the stale cache and
// the shared-module lint.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { __resetAppCachesForTests, appPackageProblems, appRouteAllowed } from "@/lib/apps";
import { __resetPackageCachesForTests } from "@/lib/plugins";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";
import { ADULT_HOST, installNewsApp, putItem, removeNewsApp, resetNewsState, seedFeeds } from "./support/newsFixture";

beforeEach(() => resetDb());
afterEach(() => { rmSync(installedPackageVersionDir("remind", "9.9.9"), { recursive: true, force: true }); __resetPackageCachesForTests(); __resetAppCachesForTests(); });
async function fixtureApps(client: TestClient): Promise<Array<Record<string, unknown>>> { const rows = (await (await client.get("/api/apps")).json()) as Array<Record<string, unknown>>; return rows.filter((row) => row.package === ID); }
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


const lowIndex = { type: "page", id: "lists", title: "Lists", body: [{ type: "picker", state: "place", label: "Place", bind: { source: "package", path: "places" }, item_key_field: "id", item_label_field: "label" }] };
const call = (t: string) => ({ call: { target: t } });
// raised page references: shopping through nested section+tabs, forecast only through confirm.on_confirm of an empty_state
const raisedDoc = { type: "page", id: "more", title: "More", body: [
  { type: "section", children: [{ type: "tabs", tabs: [{ id: "a", label: "A", body: [{ type: "answer_blocks", bind: { source: "package", path: "shopping" } }] }, { id: "b", label: "B", body: [{ type: "empty_state", icon: "inbox", text: "x" }] }] }] },
  { type: "empty_state", icon: "inbox", text: "x", action: { confirm: { prompt: "sure?", on_confirm: call(`/api/plugins/${ID}/actions/secret`) } } },
] };

async function who() {
  const { client: o } = await owner();
  const t = await teen(o);
  const { client: c } = await child(o);
  const guest = await o.post("/api/people", { displayName: "Gus", role: "guest" });
  if (guest.status !== 201) throw new Error(`guest create ${guest.status}`);
  const { id } = (await guest.json()) as { id: string };
  const g = new TestClient();
  await g.post("/api/auth/select", { personId: id });
  return { o, t, c, g };
}


function raisedSetup() {
  const dir = installFixtureApp({ minRole: "child", pageRoles: { more: "teen" }, pages: lowIndex });
  writeFileSync(join(dir, "pages", "more.json"), JSON.stringify(raisedDoc));
  __resetAppCachesForTests();
  return dir;
}

describe("a raised page cannot be reached by a child or a guest", () => {
  test("page id variants all 404 for the raised page and never serve its document", async () => {
    raisedSetup();
    const { c, g, t } = await who();
    for (const v of ["more", "MORE", "More", "more/", "%6dore", "./more", "..%2fpages%2fmore", "x/../more", "/more", "more?x=1", "more%00", "more.json", "index/../more", "%2e%2e/more"]) {
      for (const viewer of [c, g]) {
        const r = await viewer.get(`/api/plugins/${ID}/pages/${v}`);
        if (r.status === 200) expect(((await r.json()) as { id?: string }).id, `variant ${v}`).not.toBe("more");
      }
    }
    expect((await t.get(`/api/plugins/${ID}/pages/more`)).status).toBe(200);
    expect((await c.get(`/api/plugins/${ID}/pages/more`)).status).toBe(404);
    expect((await g.get(`/api/plugins/${ID}/pages/index`)).status).toBe(404);
  });

  test("data id variants, methods and path tricks never return the raised page's data to a child or a guest", async () => {
    raisedSetup();
    const { c, g, t } = await who();
    for (const v of ["shopping", "SHOPPING", "shopping/", "shopping%20", "%73hopping", "shopping?x=1", "places/../shopping", "..%2fdata%2fshopping"]) {
      for (const viewer of [g]) expect((await viewer.post(`/api/plugins/${ID}/data/${v}`, {})).status, `guest ${v}`).toBe(404);
      if (v !== "shopping" && v !== "shopping/" && v !== "shopping?x=1") expect((await c.post(`/api/plugins/${ID}/data/${v}`, {})).status, `child ${v}`).not.toBe(200);
    }
    // `shopping` is also bound by nothing on the low index page here, so only the raised page names it: closed to a child.
    expect((await c.post(`/api/plugins/${ID}/data/shopping`, { place: "x" })).status).toBe(404);
    expect((await t.post(`/api/plugins/${ID}/data/shopping`, {})).status).toBe(200);
    expect((await c.get(`/api/plugins/${ID}/data/shopping`)).status).not.toBe(200);
    expect((await c.post(`/api/plugins//${ID}/data/shopping`, {})).status).not.toBe(200);
    // An action named only by a confirm's on_confirm on the raised page, and an id no page names, are closed to a child.
    expect(appRouteAllowed({ role: "child" } as PersonRow, ID, "actions", "secret")).toBe(false);
    expect(appRouteAllowed({ role: "child" } as PersonRow, ID, "data", "forecast")).toBe(false);
    expect(appRouteAllowed({ role: "teen" } as PersonRow, ID, "actions", "secret")).toBe(true);
  });

  test("regression: POST /api/plugins/:id/run does not run a page package's recipe for a viewer below a raised page", async () => {
    raisedSetup();
    const { c, g, t } = await who();
    expect((await c.post(`/api/plugins/${ID}/run`, {})).status).toBe(404);
    expect((await g.post(`/api/plugins/${ID}/run`, {})).status).toBe(404);
    expect((await t.post(`/api/plugins/${ID}/run`, {})).status).not.toBe(404);
  });

  test("regression: GET /api/plugins lists a page package without the pages and data entries above the viewer", async () => {
    raisedSetup();
    const { c, t } = await who();
    const read = async (client: TestClient) => ((await (await client.get("/api/plugins")).json()) as Array<{ id: string; contributes?: { pages?: Array<{ id: string }>; data?: Array<{ id: string }> } }>).find((row) => row.id === ID);
    const forChild = await read(c);
    expect(forChild?.contributes?.pages?.map((page) => page.id)).toEqual(["index"]);
    expect(forChild?.contributes?.data?.map((entry) => entry.id)).toEqual(["places"]);
    const forTeen = await read(t);
    expect(forTeen?.contributes?.pages?.map((page) => page.id)).toEqual(["index", "more"]);
  });

  test("regression: the media-app gate honours page floors (index floor, and every data id)", async () => {
    const { mediaAppAllowed } = await import("@/lib/media/appHost");
    installFixtureApp({ minRole: "child", pageRoles: { index: "adult", more: "adult" } });
    expect(mediaAppAllowed({ role: "child" } as PersonRow, ID)).toBe(false);
    expect(mediaAppAllowed({ role: "owner" } as PersonRow, ID)).toBe(true);
  });

  test("regression: raising a page floor in the manifest without a version bump takes effect (the app cache stamp covers the manifest)", async () => {
    const dir = installFixtureApp({ minRole: "child" });
    const { c } = await who();
    expect((await c.get(`/api/plugins/${ID}/pages/more`)).status).toBe(200);
    const path = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf-8"));
    manifest.contributes.pages[1].min_role = "teen";
    writeFileSync(path, JSON.stringify(manifest));
    __resetPackageCachesForTests();
    expect((await c.get(`/api/plugins/${ID}/pages/more`)).status).toBe(404);
  });

  test("regression: two page entries may not share one module file (an alias would open the raised page at the lowest floor)", async () => {
    const dir = installFixtureApp({ minRole: "child", pageRoles: { more: "teen" } });
    const path = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf-8"));
    manifest.contributes.pages.push({ id: "alias", label: "Alias", nav: true, kind: "schema", module: "more" });
    writeFileSync(path, JSON.stringify(manifest));
    __resetPackageCachesForTests();
    __resetAppCachesForTests();
    expect(appPackageProblems(manifest, dir).join(" ")).toContain("shares its module");
    const { c } = await who();
    expect((await c.get(`/api/plugins/${ID}/pages/alias`)).status).toBe(404);
    expect((await c.get(`/api/plugins/${ID}/pages/more`)).status).toBe(404);
  });

  test("a page that lowers the package floor is refused at install and the app is not served", async () => {
    const dir = installFixtureApp({ minRole: "adult", pageRoles: { more: "child" } });
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
    expect(appPackageProblems(manifest, dir).join(" ")).toContain("a page may only raise the floor");
    const { o } = await who();
    expect(await fixtureApps(o)).toEqual([]);
  });
});

// NEWS-02a: the News routes against the floors. My Mix (teen) owns `mix` and `reset_mix`; the shared-screen id belongs to no page and so needs
// every page's floor; a guest is below the package. A child and a guest get 404 on every route a raised page owns, and the picture route
// answers only for an item in the asker's released set.
describe("the News routes honour the page floors", () => {
  afterEach(() => removeNewsApp());
  test("a child and a guest are closed out of My Mix's data, its action, the unowned shared-screen id and the app's data and actions respectively", async () => {
    resetNewsState();
    installNewsApp();
    const feeds = seedFeeds();
    const item = putItem(feeds.household, ADULT_HOST);
    const { c, g, t } = await who();
    const post = (client: TestClient, path: string, body: unknown = {}) => client.post(`/api/plugins/news/${path}`, body);
    for (const path of ["data/mix", "data/household-today", "actions/reset_mix", "actions/summarize", "data/nothing"]) expect((await post(c, path)).status, `child ${path}`).toBe(404);
    for (const path of ["data/today", "data/mix", "data/topics", "data/story", "data/household-today", "actions/follow", "actions/save", "actions/reset_mix"]) expect((await post(g, path, { id: item.id })).status, `guest ${path}`).toBe(404);
    expect((await g.get(`/api/plugins/news/images/${item.id}?w=480`)).status).toBe(404);
    // The item is an adult-list item: the child may reach the route but it is not in their released set.
    expect((await c.get(`/api/plugins/news/images/${item.id}?w=480`)).status).toBe(404);
    expect((await post(t, "data/mix")).status).toBe(200);
    expect((await post(t, "actions/reset_mix")).status).toBe(200);
    expect(appRouteAllowed({ role: "child" } as PersonRow, "news", "actions", "reset_mix")).toBe(false);
    expect(appRouteAllowed({ role: "child" } as PersonRow, "news", "data", "today")).toBe(true);
    expect(appRouteAllowed({ role: "guest" } as PersonRow, "news", "data", "today")).toBe(false);
  });
});
