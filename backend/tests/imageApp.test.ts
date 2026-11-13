import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { PACKAGES_DIR } from "@/lib/paths";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appPackageProblems, getAppData, getAppPage, sidebarFor } from "@/lib/apps";
import { loadManifestOnly, __resetPackageCachesForTests } from "@/lib/plugins";
import { listLibrary } from "@/lib/library";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
afterEach(() => __resetPackageCachesForTests());

test("Image is a valid bundled app with five groups and every page file", async () => {
  const loaded = loadManifestOnly("image");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const contributes = loaded.value.contributes as { sidebar: { groups: Array<{ title?: string; pages: string[] }> }; pages: Array<{ id: string; module: string }> };
  expect(contributes.sidebar.groups.map((group) => group.title ?? "")).toEqual(["", "Library", "Cast and places", "Make", "Edit"]);
  expect(contributes.sidebar.groups).toHaveLength(5);
  expect(appPackageProblems(loaded.value, join(PACKAGES_DIR, "image"))).toEqual([]);
  for (const page of contributes.pages) expect(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8")).toBeTruthy();
  const ajv = new Ajv2020({ strict: false });
  for (const page of contributes.pages) expect(ajv.validate(UI_SCHEMA as object, JSON.parse(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8")))).toBe(true);
});

test("Image launcher, sidebar groups and template rows are available to the household", async () => {
  const { client, row } = await owner();
  const apps = await (await client.get("/api/apps")).json() as Array<{ package: string; label: string; icon: string; sidebar: unknown }>;
  expect(apps.find((app) => app.package === "image")).toMatchObject({ package: "image", label: "Image", icon: "image" });
  const manifest = loadManifestOnly("image");
  if (!manifest.ok) throw new Error("Image manifest missing");
  expect((sidebarFor(row, manifest.value, manifest.value.contributes as never)?.groups ?? []).map((group) => group.title ?? "")).toEqual(["", "Library", "Cast and places", "Make", "Edit"]);
  const templates = await client.post("/api/plugins/image/data/templates", {});
  expect(templates.status).toBe(200);
  expect((await templates.json() as Array<{ id: string; title: string }>).some((item) => item.id && item.title)).toBe(true);
});

test("Image library rows match Library visibility for owner, teen and child", async () => {
  const { client: ownerClient, row: ownerRow } = await owner();
  const teenClient = await teen(ownerClient);
  const teenRow = db.select().from(people).where(eq(people.displayName, "Bramble")).get()!;
  const { client: childClient, row: childRow } = await child(ownerClient);
  const read = async (client: typeof ownerClient) => await (await client.post("/api/plugins/image/data/library", {})).json() as Array<{ id: string }>;
  for (const [client, person] of [[ownerClient, ownerRow], [teenClient, teenRow], [childClient, childRow]] as const) {
    const actual = await read(client);
    const expected = listLibrary(person, { type: "image", sort: "newest", limit: 20 }).items.map((file) => file.id);
    expect(actual.map((file) => file.id)).toEqual(expected);
  }
});

test("Image Create fills every preset under Style and keeps Shape and Pictures together in Settings", async () => {
  const { row } = await owner();
  const page = getAppPage(row, "image", "create");
  expect(page.ok).toBe(true);
  if (!page.ok) return;
  const filledPage = page.value as { body: Array<{ type: string; chips: Array<{ state: string; group?: string; icon?: string }> }> };
  const bar = filledPage.body[0]!;
  expect(bar.chips.slice(0, 2).map((chip) => [chip.state, chip.group])).toEqual([["shape", "Settings"], ["count", "Settings"]]);
  expect(bar.chips.slice(2).every((chip) => chip.group === "Style")).toBe(true);
  expect(bar.chips[0]?.icon).toBe("rectangle-horizontal");
  expect(bar.chips[2]?.icon).toBe("palette");
});
