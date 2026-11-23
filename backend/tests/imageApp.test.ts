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
import { attachments, mediaSubjects, pictureJobs } from "@/db/schema";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
afterEach(() => __resetPackageCachesForTests());

test("Image is a valid bundled app with four groups and every page file", async () => {
  const loaded = loadManifestOnly("image");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const contributes = loaded.value.contributes as { sidebar: { groups: Array<{ title?: string; pages: string[] }> }; pages: Array<{ id: string; module: string }> };
  expect(contributes.sidebar.groups.map((group) => group.title ?? "")).toEqual(["", "Library", "Make", "Edit"]);
  expect(contributes.sidebar.groups).toHaveLength(4);
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
  const iconNames = new Set(["heart", "layout-grid", "clock", "folder", "users", "file-text", "wand-sparkles", "layout-dashboard", "image", "sparkles", "square-pen"]);
  const rows = contributes.sidebar.groups.flatMap((group) => group.pages.map((id) => contributes.pages.find((page) => page.id === id)!));
  expect(new Set(rows.map((page) => page.icon)).size).toBe(rows.length);
  for (const page of rows) expect(iconNames.has(page.icon)).toBe(true);
  expect(contributes.sidebar.groups.map((group) => [group.id, group.title ?? ""])).toEqual([["browse-home", ""], ["browse-library", "Library"], ["create-make", "Make"], ["create-edit", "Edit"]]);
  expect(contributes.pages.find((page) => page.id === "index")?.label).toBe("Image");
  expect(contributes.pages.find((page) => page.id === "create")?.label).toBe("New picture");
  const placeholders: Record<string, string> = {
    favorites: "Pictures you heart show up here so you can find them again.",
    collections: "Group pictures into named collections, like a trip or a project.",
    shared: "Pictures other people at home chose to share with you will show up here.",
    drafts: "Pictures you started and have not finished wait here.",
  };
  for (const [id, text] of Object.entries(placeholders)) {
    const page = contributes.pages.find((item) => item.id === id)!;
    const doc = JSON.parse(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8"));
    const state = doc.body[0];
    expect(state).toMatchObject({ type: "empty_state", icon: page.icon, text, action: { navigate: { to: "/apps/image/create" } }, action_label: "Make a picture" });
  }
  for (const page of contributes.pages) expect(readFileSync(join(PACKAGES_DIR, "image", "pages", `${page.module}.json`), "utf8")).not.toContain("coming soon");
  for (const id of ["from-reference", "from-template", "combine"]) expect(contributes.pages.find((page) => page.id === id)?.nav).toBe(false);
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
  for (const id of ["from-reference", "from-template", "combine"]) {
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
  expect(sidebarGroups.map((group) => group.title ?? "")).toEqual(["", "Library", "Make", "Edit"]);
  expect(sidebarGroups.find((group) => group.id === "create-make")?.pages?.map((page) => page.page)).toEqual(["create", "templates", "creations"]);
  expect(sidebarGroups.find((group) => group.id === "create-edit")?.pages?.map((page) => page.page)).toEqual(["studio"]);
  const templates = await client.post("/api/plugins/image/data/templates", {});
  expect(templates.status).toBe(200);
  const templateRows = await templates.json() as Array<{ id: string; title: string }>;
  expect(templateRows.some((item) => item.id && item.title)).toBe(true);
  // A template is a recipe: the Templates page opens Create with the template selected (no text copied into the box).
  const templatesPage = await client.get("/api/plugins/image/pages/templates");
  expect(JSON.stringify(await templatesPage.json())).toContain('"template":"{id}"');
  const createPage = await client.get("/api/plugins/image/pages/create");
  expect(JSON.stringify(await createPage.json())).toContain('"template":"{id}"');
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
  expect((bar as unknown as { tier: { tiers: Array<{ id: string; hint: string }> } }).tier.tiers.map(({ id, hint }) => [id, hint])).toEqual([["standard", "Fast."], ["boost", "More detail."], ["max", "More detail."]]);
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
  // The recipe form: one labelled field per plain blank, shown only while its template is chosen, and the values ride as `blanks`.
  const recipeFields = (bar as unknown as { fields?: Array<{ state: string; label: string; when: { state: string; equals: string } }> }).fields ?? [];
  expect(recipeFields.length).toBeGreaterThan(5);
  expect(recipeFields.every((field) => field.when.state === "template" && /^blank_[a-z0-9_]+$/.test(field.state))).toBe(true);
  expect(recipeFields.some((field) => field.label === "Subject")).toBe(true);
  expect(args.blanks).toMatchObject({ subject: "{blank_subject}" });
  expect(recipeFields.some((field) => field.state.includes("photo_") || field.state.includes("cast_"))).toBe(false);
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

test("Image Create level hints add a measured wait only for a level with 3 finished pictures", async () => {
  const { row } = await owner();
  const now = new Date().toISOString();
  const seed = (n: number, tier: "boost" | undefined, ms: number) => {
    for (let i = 0; i < n; i++) {
      db.insert(pictureJobs).values({ id: `wait-${tier ?? "standard"}-${i}`, personId: row.id, kind: "generate", state: "done", prompt: "a fox", request: JSON.stringify({ size: "square", n: 1, ...(tier ? { tier } : {}) }), files: JSON.stringify([{ id: `f${i}`, width: 1, height: 1, seed: null, model: null, steps: null, ms }]), createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    }
  };
  seed(3, undefined, 21000);
  seed(2, "boost", 90000);
  const page = getAppPage(row, "image", "create");
  expect(page.ok).toBe(true);
  if (!page.ok) return;
  const bar = (page.value as { body: Array<unknown> }).body[0] as { tier: { tiers: Array<{ id: string; hint: string }> } };
  expect(bar.tier.tiers.map(({ id, hint }) => [id, hint])).toEqual([["standard", "Fast. About 20 seconds."], ["boost", "More detail."], ["max", "More detail."]]);
});
