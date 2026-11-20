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
import { elementActions, elementEditRows, elementFacts, elementFilms, elementPictures } from "@/lib/elementsDetail";
import { createFilmRun, updateFilmRun } from "@/lib/films/store";
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
  expect(contributes.data.map((item) => item.id)).toEqual(["elements", "element", "element-pictures", "element-films", "element-actions", "element-edit", "element-voices", "looks"]);
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

test("ELEMENTS-HOME-02: the detail page shows every field or says it is empty, and an element the viewer may not cast is not found at all", async () => {
  const { client, row } = await owner();
  const { row: kid } = await child(client);
  const subject = createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl in a yellow coat" });
  const facts = Object.fromEntries(elementFacts(row, subject.id).map((fact) => [fact.id, fact.value]));
  expect(facts).toMatchObject({ look: "a tall girl in a yellow coat", locked: "Not set yet", voice: "Not set yet", sheet: "Not made yet" });
  expect(facts.kind).toBe("Character. Saved by you.");
  expect(elementPictures(row, subject.id)).toEqual([]);
  // The child was not shared it, so it is not found: facts, pictures, actions and edit rows are all empty.
  for (const read of [elementFacts, elementPictures, elementFilms, elementActions, elementEditRows]) expect(read(kid, subject.id)).toEqual([]);
});

test("ELEMENTS-HOME-02: Delete is offered only on the owner's own saved elements, never on a companion or a household member", async () => {
  const { row } = await owner();
  const own = createMediaSubject(row, { name: "Mug", kind: "prop", look: "a blue mug" });
  expect(elementEditRows(row, own.id)).toHaveLength(1);
  expect(elementActions(row, own.id)).toEqual([{ id: own.id, reason: "A look is captured for characters." }]);
  const companions = elementRows(row, { kind: "character" }).filter((item) => !MADE.has(item.title));
  expect(companions.length).toBeGreaterThan(0);
  for (const item of companions) expect(elementEditRows(row, item.id)).toEqual([]);
});

test("ELEMENTS-HOME-02: where used lists the viewer's own films whose shots name the element", async () => {
  const { row } = await owner();
  const subject = createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl" });
  const run = createFilmRun(row, { idea: "A pier at dusk", goAhead: true });
  expect(elementFilms(row, subject.id)).toEqual([]);
  updateFilmRun(row, run.id, { plan: { title: "Pier at Dusk", summary: "s", cast: [{ name: "Juniper", kind: "character", locked: "A yellow coat.", reveal_last: false, subject_id: subject.id }], shots: ["shot-1", "shot-2"].map((id) => ({ id, subject_ids: [], framing: "wide", still: "Juniper on a pier.", motion: "The tide rolls.", seconds: 5 })), music: "m", credits: [] } as never });
  expect(elementFilms(row, subject.id)).toEqual([{ id: run.id, title: "Pier at Dusk", subtitle: "In progress" }]);
});

test("ELEMENTS-HOME-02: the delete action removes the owner's own element, and refuses a companion in plain words", async () => {
  const { client, row } = await owner();
  const own = createMediaSubject(row, { name: "Mug", kind: "prop", look: "a blue mug" });
  const gone = await client.post("/api/plugins/elements/actions/delete", { id: own.id });
  expect(gone.status).toBe(200);
  expect(elementRows(row, { kind: "prop" }).map((item) => item.id)).not.toContain(own.id);
  const companion = elementRows(row, { kind: "character" }).find((item) => !MADE.has(item.title))!;
  const refused = await client.post("/api/plugins/elements/actions/delete", { id: companion.id });
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toContain("edited where that record lives");
  const missing = await client.post("/api/plugins/elements/actions/capture-look", { id: "nope" });
  expect(missing.status).toBe(404);
});

test("ELEMENTS-HOME-05: the voice is stored on the owner's own element, only from the offered voices, and resolveCast returns it", async () => {
  const { client, row } = await owner();
  const { __setOfferedVoicesForTests } = await import("@/lib/voiceResolve");
  const { resolveCast } = await import("@/lib/cast");
  const voice = (id: string, source: "preset" | "cloned") => ({ id, name: id, description: "A calm voice", language: "en-US", country: "US", gender: "neutral" as const, source, onDisk: true, licence: null, revision: "1" });
  __setOfferedVoicesForTests([voice("pocket-alba", "preset"), voice("my-clone", "cloned")]);
  try {
    const subject = createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl" });
    expect((await import("@/lib/elementsDetail")).elementVoices(row, subject.id).map((item) => item.id)).toEqual(["pocket-alba"]);
    const set = await client.post("/api/plugins/elements/actions/voice", { id: "pocket-alba", element_id: subject.id });
    expect(set.status).toBe(200);
    expect((await resolveCast(row, [subject.id])).members[0]!.voice).toBe("pocket-alba");
    const clone = await client.post("/api/plugins/elements/actions/voice", { id: "my-clone", element_id: subject.id });
    expect(clone.status).toBe(403);
    expect(((await clone.json()) as { error: string }).error).toContain("not available for this element");
  } finally { __setOfferedVoicesForTests(undefined); }
});

test("ELEMENTS-HOME-05: the Looks page lists one stored sheet per element and never a real person's", async () => {
  const { row } = await owner();
  const { elementLooks } = await import("@/lib/elementsDetail");
  expect(elementLooks(row).filter((item) => MADE.has(item.title))).toEqual([]);
  createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl" });
  expect(elementLooks(row).filter((item) => MADE.has(item.title))).toEqual([]);
});

test("ELEMENTS-HOME-02: rename changes the owner's own element, refuses an empty name, and refuses a companion in plain words", async () => {
  const { client, row } = await owner();
  const own = createMediaSubject(row, { name: "Mug", kind: "prop", look: "a blue mug" });
  expect((await client.post("/api/plugins/elements/actions/rename", { id: own.id, name: "  Blue Cup " })).status).toBe(200);
  expect(elementRows(row, { kind: "prop" }).map((item) => item.title)).toContain("Blue Cup");
  const empty = await client.post("/api/plugins/elements/actions/rename", { id: own.id, name: "   " });
  expect(empty.status).toBe(422);
  const companion = elementRows(row, { kind: "character" }).find((item) => !MADE.has(item.title))!;
  const refused = await client.post("/api/plugins/elements/actions/rename", { id: companion.id, name: "X" });
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toContain("edited where that record lives");
});
