import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { PACKAGES_DIR } from "@/lib/paths";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appPackageProblems, appRouteAllowed, getAppData, getAppPage, sidebarFor } from "@/lib/apps";
import { loadManifestOnly, __resetPackageCachesForTests } from "@/lib/plugins";
import { listLibrary } from "@/lib/library";
import { imageAppData } from "@/lib/imageApp";
import { createMediaSubject, shareMediaSubject } from "@/lib/mediaSubjects";
import { attachments, mediaSubjects } from "@/db/schema";
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

test("Image sidebar rows have distinct real icons, labels, and honest placeholder actions", async () => {
  const loaded = loadManifestOnly("image");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const contributes = loaded.value.contributes as { sidebar: { groups: Array<{ id: string; title?: string; pages: string[] }> }; pages: Array<{ id: string; label: string; icon: string; module: string; nav: boolean }> };
  const iconNames = new Set(["house", "heart", "layout-grid", "clock", "folder", "users", "file-text", "user-round", "box", "map-pin", "clapperboard", "wand-sparkles", "layout-dashboard", "image", "square-pen"]);
  const rows = contributes.sidebar.groups.flatMap((group) => group.pages.map((id) => contributes.pages.find((page) => page.id === id)!));
  expect(new Set(rows.map((page) => page.icon)).size).toBe(rows.length);
  for (const page of rows) expect(iconNames.has(page.icon)).toBe(true);
  expect(contributes.sidebar.groups.map((group) => [group.id, group.title ?? ""])).toEqual([["browse-home", ""], ["browse-library", "Library"], ["browse-cast", "Cast and places"], ["create-make", "Make"], ["create-edit", "Edit"]]);
  expect(contributes.pages.find((page) => page.id === "index")?.label).toBe("Home");
  expect(contributes.pages.find((page) => page.id === "create")?.label).toBe("New picture");
  const placeholders: Record<string, string> = {
    favorites: "Pictures you heart show up here so you can find them again.",
    collections: "Group pictures into named collections, like a trip or a project.",
    shared: "Pictures other people at home chose to share with you will show up here.",
    drafts: "Pictures you started and have not finished wait here.",
    props: "Objects you reuse in pictures, like a favourite mug or a guitar, will live here.",
    places: "Places you reuse in pictures, like your kitchen or a beach, will live here.",
    productions: "Longer projects built from many pictures, like a comic or a storyboard, will live here.",
  };
  for (const [id, text] of Object.entries(placeholders)) {
    const page = contributes.pages.find((item) => item.id === id)!;
    const doc = JSON.parse(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8"));
    const state = doc.body[0];
    expect(state).toMatchObject({ type: "empty_state", icon: page.icon, text, action: { navigate: { to: "/apps/image/create" } }, action_label: "Make a picture" });
  }
  for (const page of contributes.pages) expect(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8")).not.toContain("coming soon");
  for (const id of ["from-reference", "from-template", "character-sheet", "combine"]) expect(contributes.pages.find((page) => page.id === id)?.nav).toBe(false);
});

test("Image menu exposes working Create rows and keeps placeholders out of navigation", async () => {
  const loaded = loadManifestOnly("image");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const contributes = loaded.value.contributes as { sidebar: { groups: Array<{ id: string; pages: string[] }> }; pages: Array<{ id: string; label: string; nav: boolean }> };
  expect(contributes.sidebar.groups.find((group) => group.id === "browse-home")?.pages).toEqual(["index", "favorites"]);
  expect(contributes.sidebar.groups.find((group) => group.id === "create-make")?.pages).toEqual(["create", "templates", "creations"]);
  expect(contributes.sidebar.groups.find((group) => group.id === "create-edit")?.pages).toEqual(["studio"]);
  expect(contributes.sidebar.groups.every((group) => group.pages.every((id) => contributes.pages.some((page) => page.id === id)))).toBe(true);
  expect(contributes.pages.find((page) => page.id === "creations")?.label).toBe("My creations");
  expect(contributes.pages.find((page) => page.id === "templates")?.label).toBe("Templates");
  for (const id of ["from-reference", "from-template", "character-sheet", "combine"]) {
    expect(contributes.sidebar.groups.some((group) => group.pages.includes(id))).toBe(false);
    expect(contributes.pages.find((page) => page.id === id)?.nav).toBe(false);
    const doc = JSON.parse(readFileSync(join(PACKAGES_DIR, "image", "pages", `${id}.json`), "utf8"));
    expect(doc.body[0]).toMatchObject({ action: { navigate: { to: "/apps/image/create" } }, action_label: "Open Create" });
  }
});

test("Image launcher, sidebar groups and template rows are available to the household", async () => {
  const { client, row } = await owner();
  const manifest = loadManifestOnly("image");
  if (!manifest.ok) throw new Error("Image manifest missing");
  const sidebarGroups = (sidebarFor(row, manifest.value, manifest.value.contributes as never)?.groups ?? []);
  expect(sidebarGroups.map((group) => group.title ?? "")).toEqual(["", "Library", "Cast and places", "Make", "Edit"]);
  expect(sidebarGroups.find((group) => group.id === "create-make")?.pages?.map((page) => page.page)).toEqual(["create", "templates", "creations"]);
  expect(sidebarGroups.find((group) => group.id === "create-edit")?.pages?.map((page) => page.page)).toEqual(["studio"]);
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

test("Image Create submits to make, fills presets, and shows what was made on a picture shelf", async () => {
  const { row } = await owner();
  const page = getAppPage(row, "image", "create");
  expect(page.ok).toBe(true);
  if (!page.ok) return;
  const filledPage = page.value as { body: Array<{ type: string; chips?: Array<{ state: string; group?: string; icon?: string; icon_only?: boolean; options?: Array<{ value: string | number; icon?: string; label: string }> }>; styles?: Array<{ state: string; group?: string; icon?: string; icon_only?: boolean; options?: Array<{ value: string | number; icon?: string; label: string }> }>; submit?: unknown }> };
  const bar = filledPage.body[0]!;
  expect(bar.chips!.slice(0, 3).map((chip) => [chip.state, chip.group])).toEqual([["shape", "Shape"], ["count", "Pictures"], ["set", "Pictures"]]);
  expect(bar.chips![2]!.options!.map((option) => [option.value, option.label])).toEqual([[0, "1 picture"], [4, "A set of 4"], [6, "A set of 6"]]);
  expect(bar).toMatchObject({ placeholder: 'Describe the picture. Put exact words in quotes, like "Summer Fair". Type @ to add someone from your cast.' });
  expect((bar as unknown as { tier: { tiers: Array<{ id: string; hint: string }> } }).tier.tiers.map(({ id, hint }) => [id, hint])).toEqual([["standard", "Fast. Shows no words on the picture."], ["boost", "More detail. Shows no words unless you ask for them."], ["max", "More detail. Shows no words unless you ask for them."]]);
  expect(bar.chips![0]).toMatchObject({ icon: "rectangle-horizontal", icon_only: true, options: [{ value: "square", icon: "square" }, { value: "landscape", icon: "rectangle-horizontal" }, { value: "portrait", icon: "rectangle-vertical" }, { value: "wide", icon: "monitor" }, { value: "tall", icon: "smartphone" }] });
  expect(bar.chips![1]).toMatchObject({ icon: "layers", icon_only: true });
  expect(bar.chips!.slice(4).every((chip) => chip.group === "Style" && chip.icon_only)).toBe(true);
  expect(bar.chips![0]?.icon).toBe("rectangle-horizontal");
  expect(bar.submit).toMatchObject({ call: { target: "/api/plugins/image/actions/make", method: "POST", args: { prompt: "{prompt}", shape: "{shape}", count: "{count}", set: "{set}", tier: "{tier}", reference: "{reference}" } } });
  expect((bar as unknown as { references: Array<Record<string, unknown>> }).references[0]).toMatchObject({ state: "reference", max: 3 });
  const args = (bar.submit as { call: { args: Record<string, unknown> } }).call.args;
  expect(args.look_art).toBe("{look_art}");
  expect(args.light).toBe("{light}");
  expect(bar.chips!.find((chip) => chip.state === "template")).toMatchObject({ state: "template", label: "Template", group: "Template", icon: "sparkles", icon_only: true, presentation: "popover", default: "none", quiet_value: "none" });
  const templateChip = bar.chips!.find((chip) => chip.state === "template")!;
  const templatesResponse = (await import("@/lib/media/templates")).listTemplates({ actor: row, kind: "picture" });
  expect(templateChip.options).toEqual([{ value: "none", label: "No template" }, ...templatesResponse.map((template) => ({ value: template.id, label: template.title }))]);
  expect(args.template).toBe("{template}");
  expect(filledPage.body[1]).toMatchObject({ type: "media_shelf", heading: "Templates", bind: { source: "package", path: "templates" }, item_media_field: "thumbnail", item_label_field: "title", aspect: "square", on_select: { navigate: { to: "/apps/image/create", state: { template: "{id}" } } } });
  expect(filledPage.body[2]).toMatchObject({ type: "media_shelf", heading: "My creations", bind: { source: "package", path: "recent" }, item_subtitle_field: "{subtitle}", item_badge_field: "badge", item_meta_field: "meta", item_progress_field: "progress", making_field: "making", poll_while: { field: "making", values: ["yes"] } });
  const manifest = loadManifestOnly("image");
  expect(manifest.ok && (manifest.value.contributes as { data: Array<{ id: string }> }).data.some((item) => item.id === "recent")).toBe(true);
  expect(appRouteAllowed(row, "image", "data", "recent")).toBe(true);
  expect(((bar as unknown as { references: Array<{ state: string; disabled_reason?: string }> }).references)[0]?.disabled_reason).toBeUndefined();
});

test("My creations is a schema-valid media shelf bound to recent creations", async () => {
  const { row } = await owner();
  const page = getAppPage(row, "image", "creations");
  expect(page.ok).toBe(true);
  if (!page.ok) return;
  const doc = page.value as { body: Array<Record<string, unknown>> };
  const ajv = new Ajv2020({ strict: false });
  expect(ajv.validate(UI_SCHEMA as object, page.value)).toBe(true);
  expect(doc.body[0]).toMatchObject({ type: "media_shelf", heading: "My creations", bind: { source: "package", path: "recent" }, item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail", item_subtitle_field: "{subtitle}", item_badge_field: "badge", item_meta_field: "meta", making_field: "making", poll_while: { field: "making", values: ["yes"] }, aspect: "square", layout: "grid", on_select: { navigate: { to: "/apps/image/studio", state: { file: "{id}" } } } });
});

test("Recently made is a schema-valid shelf of recent creations", async () => {
  const { row } = await owner();
  const page = getAppPage(row, "image", "recent");
  expect(page.ok).toBe(true);
  if (!page.ok) return;
  expect((page.value as { body: unknown[] }).body[0]).toMatchObject({ type: "media_shelf", heading: "Recently made", bind: { source: "package", path: "recent" }, item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail", item_subtitle_field: "{subtitle}", item_badge_field: "badge", item_meta_field: "meta", making_field: "making", poll_while: { field: "making", values: ["yes"] }, aspect: "square", layout: "grid", on_select: { navigate: { to: "/apps/image/studio", state: { file: "{id}" } } } });
});

test("USE-AS-REFERENCE: the Studio top bar can send a picture to Create as its reference, and Create reads it into the make call", async () => {
  const { row } = await owner();
  const studio = getAppPage(row, "image", "studio");
  const create = getAppPage(row, "image", "create");
  expect(studio.ok && create.ok).toBe(true);
  if (!studio.ok || !create.ok) return;
  const editor = (studio.value as { body: Array<{ type: string; actions?: Array<{ label: string; action?: unknown; hand_off?: string }> }> }).body.find((node) => node.type === "image_editor")!;
  expect(editor.actions).toContainEqual({ label: "Use as a reference", action: { navigate: { to: "/apps/image/create", state: { reference: "{file}" } } } });
  expect(editor.actions!.length).toBeLessThanOrEqual(3);
  const bar = (create.value as { body: Array<{ references?: Array<{ state: string; max: number }>; submit?: { call: { args: Record<string, unknown> } } }> }).body[0]!;
  expect(bar.references![0]).toMatchObject({ state: "reference", max: 3 });
  expect(bar.submit!.call.args.reference).toBe("{reference}");
});

test("Characters page is a shelf of the cast that opens Create with the cast chip, and says so plainly when empty", () => {
  const doc = JSON.parse(readFileSync(join(PACKAGES_DIR, "image", "pages", "characters.json"), "utf8"));
  expect(new Ajv2020({ strict: false }).validate(UI_SCHEMA as object, doc)).toBe(true);
  const shelf = doc.body[0];
  expect(shelf).toMatchObject({ type: "media_shelf", layout: "grid", item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail", bind: { source: "package", path: "characters" }, on_select: { navigate: { to: "/apps/image/create", state: { cast: "{id}" } } } });
  expect(shelf.empty_state).toMatchObject({ text: "No characters yet. Make one and it can appear in any picture.", action_label: "Make a character", action: { navigate: { to: "/apps/image/create" } } });
  const loaded = loadManifestOnly("image");
  expect(loaded.ok && (loaded.value.contributes as { data: Array<{ id: string }> }).data.some((item) => item.id === "characters")).toBe(true);
});

test("characters data lists only the viewer's own saved characters, never props or places, and a minor never sees an adult-only one", async () => {
  const { row } = await owner();
  expect(imageAppData(row, "characters", {})).toEqual([]);
  const mine = createMediaSubject(row, { name: "Juniper", kind: "character", look: "a tall girl in a yellow coat" });
  createMediaSubject(row, { name: "Mug", kind: "prop", look: "a blue mug" });
  db.update(mediaSubjects).set({ referenceIds: JSON.stringify(["file-a", "file-b"]) }).where(eq(mediaSubjects.id, mine.id)).run();
  const rows = imageAppData(row, "characters", {}) as Array<Record<string, unknown>>;
  expect(rows.map((item) => item.title)).toEqual(["Juniper"]);
  expect(rows[0]).toMatchObject({ id: mine.id, subtitle: "Character, 2 pictures" });
  expect(Object.keys(rows[0]!).sort()).toEqual(["id", "subtitle", "thumbnail", "title"]);
});

test("characters data keeps a child to their own subjects and drops real-person and adult-only ones", async () => {
  const { client, row } = await owner();
  const { row: kid } = await child(client);
  const now = new Date().toISOString();
  const real = createMediaSubject(row, { name: "Real", kind: "character", look: "a real person", real: true });
  const adultOnly = createMediaSubject(row, { name: "Spicy", kind: "character", look: "an adult look" });
  const plain = createMediaSubject(row, { name: "Plain", kind: "character", look: "a cartoon fox" });
  db.insert(attachments).values({ id: "file-adult", ownerPersonId: row.id, mediaType: "image/png", size: 1, sha256: "x", storagePath: "x", retention: "kept", provenance: 'media-subject-reference:{"audience":"adult-only"}', createdAt: now, hlc: "1:0:test" }).run();
  db.update(mediaSubjects).set({ referenceIds: JSON.stringify(["file-adult"]) }).where(eq(mediaSubjects.id, adultOnly.id)).run();
  for (const item of [real, adultOnly, plain]) shareMediaSubject(row, item.id, kid.id, true);
  expect((imageAppData(row, "characters", {}) as Array<{ title: string }>).map((item) => item.title).sort()).toEqual(["Plain", "Real", "Spicy"]);
  expect((imageAppData(kid, "characters", {}) as Array<{ title: string }>).map((item) => item.title)).toEqual(["Plain"]);
  const own = createMediaSubject(kid, { name: "Kitty", kind: "character", look: "a cat" });
  expect((imageAppData(kid, "characters", {}) as Array<{ id: string }>).map((item) => item.id)).toContain(own.id);
  expect((imageAppData(row, "characters", {}) as Array<{ id: string }>).map((item) => item.id)).not.toContain(own.id);
});
