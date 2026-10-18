// NEWS-SIDEBAR-01: the News sidebar the hub hands each person (reduced to what they may open), and the load-time check of the
// objects the manifest schema leaves to the UI schema.
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appPackageProblems, __resetAppCachesForTests } from "@/lib/apps";
import { PACKAGES_DIR } from "@/lib/paths";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { AppRow } from "@/lib/apps";
import { child, owner, teen } from "./support/testAuth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { setValue } from "@/lib/settings";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

const dir = join(PACKAGES_DIR, "news");
const manifest = (): PackageManifest => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as PackageManifest;

beforeEach(() => { resetDb(); __resetAppCachesForTests(); });

async function newsRow(viewer: TestClient): Promise<AppRow | undefined> {
  const apps = await (await viewer.get("/api/apps")).json() as AppRow[];
  return apps.find((app) => app.package === "news");
}
const pagesOf = (row: AppRow | undefined, group: string): string[] => row?.sidebar?.groups.find((g) => g.id === group)?.pages?.map((p) => p.page) ?? [];

test("the shipped News manifest passes the sidebar's schema and package checks", () => {
  expect(appPackageProblems(manifest(), dir)).toEqual([]);
  expect(manifest().contributes?.sidebar).toBeDefined();
});

test("an adult and a teen get the whole column: Today, My Mix and Saved, topics, followed sources with Manage, and the search", async () => {
  const { client } = await owner();
  const t = await teen(client);
  for (const viewer of [client, t]) {
    const row = await newsRow(viewer);
    expect(pagesOf(row, "library")).toEqual(["index", "mix", "saved"]);
    expect(row?.sidebar?.groups.map((g) => g.id)).toEqual(["library", "topics", "following"]);
    expect(row?.sidebar?.search).toBeDefined();
    const following = row?.sidebar?.groups.find((g) => g.id === "following")?.rows as { manage?: { label: string }; only_followed?: boolean };
    expect(following.manage?.label).toBe("Manage");
    expect(following.only_followed).toBe(true);
  }
});

test("a child's column has no My Mix; what it does show points only at pages a child may open", async () => {
  const { client } = await owner();
  const kid = (await child(client)).client;
  const row = await newsRow(kid);
  expect(pagesOf(row, "library")).toEqual(["index", "saved"]);
  expect(JSON.stringify(row?.sidebar)).not.toContain("/apps/news/mix");
  for (const target of JSON.stringify(row?.sidebar).match(/\/apps\/news\/[a-z-]+/g) ?? []) {
    const page = target.split("/").pop()!;
    expect((await kid.get(`/api/plugins/news/pages/${page}`)).status).toBe(200);
  }
});

test("a teen who turned My Mix off has no My Mix entry", async () => {
  const { client } = await owner();
  const t = await teen(client);
  expect(pagesOf(await newsRow(t), "library")).toContain("mix");
  const me = (await (await t.get("/api/auth/me")).json() as { id?: string; person?: { id: string } });
  const personId = me.person?.id ?? me.id!;
  const person = db.select().from(people).where(eq(people.id, personId)).get()!;
  expect(setValue(person, `person:${person.id}`, "news.my_mix", false).ok).toBe(true);
  const row = await newsRow(t);
  expect(pagesOf(row, "library")).toEqual(["index", "saved"]);
  expect(JSON.stringify(row?.sidebar)).not.toContain("/apps/news/mix");
});

test("a guest gets no News app and so no column", async () => {
  const { client } = await owner();
  const created = await client.post("/api/people", { displayName: "Clover", role: "guest" });
  const { id } = await created.json() as { id: string };
  const guest = new TestClient();
  expect((await guest.post("/api/auth/select", { personId: id })).status).toBe(200);
  expect(await newsRow(guest)).toBeUndefined();
});

test("a malformed search node, binding or action in a sidebar fails the package check", () => {
  const bad = (edit: (sidebar: NonNullable<NonNullable<PackageManifest["contributes"]>["sidebar"]>) => void): string[] => {
    const m = manifest();
    edit(m.contributes!.sidebar as never);
    return appPackageProblems(m, dir);
  };
  expect(bad((s) => { (s.search as Record<string, unknown>).state = 5; }).join("\n")).toContain("does not match the UI schema");
  expect(bad((s) => { (s.groups[1]!.rows as Record<string, unknown>).bind = { source: "route" }; }).join("\n")).toContain("does not match the UI schema");
  expect(bad((s) => { (s.groups[1]!.rows as Record<string, unknown>).open = { navigate: { state: {} } }; }).join("\n")).toContain("does not match the UI schema");
  expect(bad((s) => { delete (s.search as Record<string, unknown>).type; }).join("\n")).not.toBe("");
});
