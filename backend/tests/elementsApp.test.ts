import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { eq } from "drizzle-orm";
import { PACKAGES_DIR } from "@/lib/paths";
import { db } from "@/db";
import { attachments, mediaSubjects } from "@/db/schema";
import { appPackageProblems } from "@/lib/apps";
import { loadManifestOnly, __resetPackageCachesForTests } from "@/lib/plugins";
import { elementRows, elementsAppData } from "@/lib/elementsApp";
import { createMediaSubject, shareMediaSubject } from "@/lib/mediaSubjects";
import { child, owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
afterEach(() => __resetPackageCachesForTests());

// The test home also lists its default companions and members (the one resolver does); these tests look at the elements they save.
const MADE = new Set(["Juniper", "Kitchen", "Mug", "Red Barn", "Red Kite", "Blue Cup", "Real", "Spicy", "Plain", "Kitty"]);
const mine = (rows: Array<{ title: string }>) => rows.map((row) => row.title).filter((title) => MADE.has(title)).sort();

test("Elements is a valid bundled app: its pages exist, validate against the page schema, and the routing examples are five or more", () => {
  const loaded = loadManifestOnly("elements");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const contributes = loaded.value.contributes as { pages: Array<{ id: string; module: string }>; data: Array<{ id: string }> };
  expect(appPackageProblems(loaded.value, join(PACKAGES_DIR, "elements"))).toEqual([]);
  expect((loaded.value.routing?.examples ?? []).length).toBeGreaterThanOrEqual(5);
  expect(loaded.value.min_role).toBe("child");
  expect(contributes.data.map((item) => item.id)).toEqual(["elements"]);
  const ajv = new Ajv2020({ strict: false });
  for (const page of contributes.pages) expect(ajv.validate(UI_SCHEMA as object, JSON.parse(readFileSync(join(PACKAGES_DIR, "elements", "pages", `${page.module}.json`), "utf8")))).toBe(true);
});

test("each kind page reads the one data source with its kind, and the search page passes the query and kind", () => {
  const bind = (page: string, index = 0) => JSON.parse(readFileSync(join(PACKAGES_DIR, "elements", "pages", `${page}.json`), "utf8")).body[index].bind;
  expect(bind("characters").params).toEqual({ kind: "character" });
  expect(bind("places").params).toEqual({ kind: "place" });
  expect(bind("props").params).toEqual({ kind: "prop" });
  expect(bind("search", 1).params).toEqual({ query: "$state.q", kind: "$state.kind" });
});

test("rows list characters, places and props by kind, with a plain kind subtitle and a picture count", async () => {
  const { row } = await owner();
  const who = createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl in a yellow coat" });
  createMediaSubject(row, { name: "Kitchen", kind: "place", look: "a sunny kitchen" });
  createMediaSubject(row, { name: "Mug", kind: "prop", look: "a blue mug" });
  db.update(mediaSubjects).set({ referenceIds: JSON.stringify(["file-a", "file-b"]) }).where(eq(mediaSubjects.id, who.id)).run();
  expect(mine(elementRows(row) as never)).toEqual(["Juniper", "Kitchen", "Mug"]);
  expect(mine(elementRows(row, { kind: "place" }) as never)).toEqual(["Kitchen"]);
  expect(mine(elementRows(row, { kind: "prop" }) as never)).toEqual(["Mug"]);
  expect(mine(elementRows(row, { kind: "character" }) as never)).toEqual(["Juniper"]);
  expect(elementRows(row, { kind: "character" }).find((item) => item.id === who.id)).toMatchObject({ subtitle: "Character, 2 pictures", kind: "character" });
  expect(Object.keys(elementRows(row)[0]!).sort()).toEqual(["id", "kind", "subtitle", "thumbnail", "title"]);
});

test("search matches names across kinds, ignoring case, and an unknown kind means all", async () => {
  const { row } = await owner();
  createMediaSubject(row, { name: "Red Barn", kind: "place", look: "a barn" });
  createMediaSubject(row, { name: "Red Kite", kind: "prop", look: "a kite" });
  createMediaSubject(row, { name: "Blue Cup", kind: "prop", look: "a cup" });
  expect(mine(elementsAppData(row, "elements", { query: "RED" }) as never)).toEqual(["Red Barn", "Red Kite"]);
  expect(mine(elementsAppData(row, "elements", { query: "red", kind: "prop" }) as never)).toEqual(["Red Kite"]);
  expect(mine(elementsAppData(row, "elements", { query: "cup", kind: "nonsense" }) as never)).toEqual(["Blue Cup"]);
  expect(elementsAppData(row, "something-else", {})).toBeNull();
});

test("a child sees their own and shared elements only: real-person and adult-only ones are absent, not locked", async () => {
  const { client, row } = await owner();
  const { row: kid } = await child(client);
  const now = new Date().toISOString();
  const real = createMediaSubject(row, { name: "Real", kind: "character", look: "a real person", real: true });
  const adultOnly = createMediaSubject(row, { name: "Spicy", kind: "place", look: "an adult look" });
  const plain = createMediaSubject(row, { name: "Plain", kind: "prop", look: "a toy" });
  db.insert(attachments).values({ id: "file-adult", ownerPersonId: row.id, mediaType: "image/png", size: 1, sha256: "x", storagePath: "x", retention: "kept", provenance: 'media-subject-reference:{"audience":"adult-only"}', createdAt: now, hlc: "1:0:test" }).run();
  db.update(mediaSubjects).set({ referenceIds: JSON.stringify(["file-adult"]) }).where(eq(mediaSubjects.id, adultOnly.id)).run();
  for (const item of [real, adultOnly, plain]) shareMediaSubject(row, item.id, kid.id, true);
  expect(mine(elementRows(row) as never)).toEqual(["Plain", "Real", "Spicy"]);
  const seen = elementRows(kid).map((item) => item.title);
  expect(seen).toContain("Plain");
  expect(seen).not.toContain("Real");
  expect(seen).not.toContain("Spicy");
  const own = createMediaSubject(kid, { name: "Kitty", kind: "character", look: "a cat" });
  expect(elementRows(kid).map((item) => item.id)).toContain(own.id);
  expect(elementRows(row).map((item) => item.id)).not.toContain(own.id);
});
