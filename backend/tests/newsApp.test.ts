// NEWS-03 owns the schema package and role floors, not the pending News data bodies.
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAppPackage, type AppContributes } from "@maipai/spec/ui/app-check.js";
import { appPackageProblems, appRouteAllowed, appImageAllowed, __resetAppCachesForTests } from "@/lib/apps";
import { PACKAGES_DIR } from "@/lib/paths";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PersonRow } from "@/types";
import { child, owner, teen } from "./support/testAuth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const dir = join(PACKAGES_DIR, "news");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as PackageManifest;
const contributes = manifest.contributes as AppContributes;
const pages = ["index", "mix", "following", "saved", "channel", "story", "search"];
const ids = ["today", "mix", "topics", "sources", "channel", "saved", "story", "more", "household-today", "search", "search-recents"];
const actions = ["follow", "save", "read", "feedback", "reset_mix", "summarize", "search_recent", "search_recent_clear"];
const readPage = (module: string) => JSON.parse(readFileSync(join(dir, "pages", `${module}.json`), "utf-8"));

beforeEach(() => { resetDb(); __resetAppCachesForTests(); });

test("the pinned spec and Home accept all seven News pages and the settings area", () => {
  expect(checkAppPackage("news", contributes, readPage, manifest.min_role)).toEqual([]);
  expect(appPackageProblems(manifest, dir)).toEqual([]);
  expect(contributes.data?.map((entry) => entry.id)).toEqual(ids);
  expect(manifest.contributes?.widgets?.find((widget) => widget.id === "headlines")).not.toHaveProperty("min_role");
});

async function profile(ownerClient: TestClient, role: "guest") {
  const created = await ownerClient.post("/api/people", { displayName: "Clover", role });
  if (created.status !== 201) throw new Error(`person create ${created.status}: ${await created.text()}`);
  const { id } = await created.json() as { id: string };
  const client = new TestClient();
  expect((await client.post("/api/auth/select", { personId: id })).status).toBe(200);
  return client;
}

test("children, teens and adults discover News; guests see no app, page or data route", async () => {
  const { client } = await owner();
  const clients = { child: (await child(client)).client, teen: await teen(client), adult: client, guest: await profile(client, "guest") };
  for (const [role, viewer] of Object.entries(clients)) {
    const apps = await (await viewer.get("/api/apps")).json() as Array<{ package: string; sections: Array<{ page: string }> }>;
    const news = apps.find((app) => app.package === "news");
    expect(!!news).toBe(role !== "guest"); // Serving this app exercises Home's private loadApp path.
    if (news) expect(news.sections.some((section) => section.page === "mix")).toBe(role !== "child");
    for (const page of pages) expect((await viewer.get(`/api/plugins/news/pages/${page}`)).status).toBe(role === "guest" || (role === "child" && page === "mix") ? 404 : 200);
    if (role === "guest") {
      for (const id of ids) expect((await viewer.post(`/api/plugins/news/data/${id}`, {})).status).toBe(404);
      for (const action of actions) expect([403, 404]).toContain((await viewer.post(`/api/plugins/news/actions/${action}`, {})).status);
      expect([403, 404]).toContain((await viewer.get("/api/plugins/news/images/fixture?w=480")).status);
    }
    if (role === "child") expect((await viewer.post("/api/plugins/news/data/mix", {})).status).toBe(404);
  }
});

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item) => walk(item, visit)); return; }
  visit(value as Record<string, unknown>);
  Object.values(value).forEach((item) => walk(item, visit));
}

test("every reference is declared and every Mix-only data id and action stays above a child", () => {
  const refs = new Map<string, { data: Set<string>; actions: Set<string> }>();
  const nodes = new Set(["page", "section", "answer_blocks", "tabs", "list", "picker", "empty_state", "search"]);
  for (const page of pages) {
    const found = { data: new Set<string>(), actions: new Set<string>() };
    walk(readPage(page), (node) => {
      if (node.type) expect(nodes.has(String(node.type))).toBe(true);
      if (node.source === "package") { expect(ids).toContain(String(node.path)); found.data.add(String(node.path)); }
      if (node.target) {
        expect(String(node.target).startsWith("/api/plugins/news/actions/")).toBe(true);
        const action = String(node.target).split("/").at(-1)!;
        expect(actions).toContain(action); found.actions.add(action);
      }
    });
    refs.set(page, found);
  }
  const mix = refs.get("mix")!;
  expect([...mix.data]).toEqual(["mix"]);
  expect([...mix.actions]).toContain("feedback");
  expect([...mix.actions]).toContain("reset_mix");
  for (const role of ["child", "teen", "adult", "guest"] as const) {
    const person = { id: "person-floor-test", role } as PersonRow;
    for (const kind of ["data", "actions"] as const) {
      for (const id of kind === "data" ? ids : actions) {
        const owners = pages.filter((page) => refs.get(page)![kind].has(id));
        const mixOnly = owners.length === 0 || owners.every((page) => page === "mix");
        expect(appRouteAllowed(person, "news", kind, id)).toBe(role !== "guest" && !(role === "child" && mixOnly));
      }
    }
    expect(appImageAllowed(person, "news")).toBe(role !== "guest");
  }
  expect([...refs.values()].some((ref) => ref.data.has("household-today"))).toBe(false);
});
