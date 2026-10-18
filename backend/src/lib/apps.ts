// APP-KIND-03: the hub side of the `app` kind (docs/plans/app-kind-2026-10-16.md). An app is an
// installed package whose manifest lists `contributes.pages[]`. This file holds the rules; the HTTP
// boundary is routes/apps.ts (the list) and routes/plugins.ts (one page, one data call).
//
// Nothing here is a second definition of anything: access is the package's own (`min_role`, smoke
// status, capabilities, platforms), the page is a spec `page` document, the place is `resolvePlace`,
// the data is the package's own recipe through `runPlugin`, and the blocks leave through
// `filterAnswerBlocks` exactly as a chat turn's do.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { checkAppPackage, type AppContributes, type AppDataEntry, type AppPageEntry } from "@maipai/spec/ui/app-check.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { CENTRAL_AREA_IDS, RESERVED_AREA_IDS, type SettingsArea } from "@maipai/spec/settings/areas-check.js";
import { speakerAgeBand } from "@/lib/ageBand";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { missingRequired, unavailableCapabilities } from "@/lib/capabilities";
import { getEntity } from "@/lib/entities";
import { ROLE_LADDER } from "@/middleware/auth";
import { listPackageIds, loadManifestOnly, meetsMinRole, runPlugin } from "@/lib/plugins";
import { resolvePackageDir } from "@/lib/packageResolve";
import { parseCurrentLocation, resolveWeatherPlace } from "@/lib/places";
import { refusePackageReplyIfUnsafe } from "@/lib/safety";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getPackageStatus, allPackageStatuses } from "@/lib/smoke";
import type { PersonRow } from "@/types";

const ajv = new Ajv2020({ strict: false });
const validateUiPage = ajv.compile(UI_SCHEMA as object);

import type { AppRow, AppSection, AppSidebar, AppSidebarGroup, AppSidebarRows } from "../wire";
export type { AppRow, AppSection };

export interface AppData {
  as_of: string;
  blocks?: unknown[];
  rows?: Array<{ id: string; label: string }>;
  degraded?: true;
  /** The page has no place to show: nothing was chosen and the person has no default or household home. */
  needs?: "place";
}

export type AppResult<T> = { ok: true; status: 200; value: T } | { ok: false; status: 404 | 400 | 502; error: string; kind?: "down" | "timed_out" | "found_nothing" | "needs_place" };

const NOT_FOUND = { ok: false, status: 404, error: "no such app" } as const;

// ---- Loading and validating an app's pages -------------------------------------------------

interface LoadedApp { manifest: PackageManifest; contributes: AppContributes; pages: Map<string, unknown>; problems: string[] }
const loadCache = new Map<string, { stamp: string; app: LoadedApp }>();
const warned = new Set<string>();

function pageFile(dir: string, module: string): string {
  return join(dir, "pages", `${module}.json`);
}

function readPage(dir: string, module: string): unknown {
  // `module` is a plain name by the manifest schema (^[a-z][a-z0-9_-]*$), so the join cannot leave `pages/`.
  if (!/^[a-z][a-z0-9_-]*$/.test(module)) return undefined;
  const path = pageFile(dir, module);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** The plain-language problems with a package's own settings area (SPEC-SETAREA-01), or an empty list. The area
 * is the manifest's declared object as is; the hub only refuses one that would collide with a central page or
 * draw something that is not the package's own: a reserved or central id, an `app` that is not `/apps/<id>`,
 * or a card whose group is not one of the package's own `config[]` groups at that scope. */
export function settingsAreaProblems(manifest: PackageManifest): string[] {
  const area = (manifest.contributes as { settings_area?: SettingsArea } | undefined)?.settings_area;
  if (!area) return [];
  const problems: string[] = [];
  if (RESERVED_AREA_IDS.includes(area.id) || CENTRAL_AREA_IDS.includes(area.id)) problems.push(`the settings area id "${area.id}" is taken by a built-in settings page; choose another id`);
  if (area.app !== `/apps/${manifest.id}`) problems.push(`the settings area must name its own app, "/apps/${manifest.id}", not "${area.app ?? ""}"`);
  const own = new Set((manifest.config ?? []).map((entry) => `${entry.scope}:${entry.lives_in}`));
  for (const section of area.sections ?? []) {
    for (const card of section.cards ?? []) {
      if (card.links) problems.push(`settings area card "${card.label}" may not hold links; a package area draws only its own settings`);
      else if (!card.group || !card.scope || !own.has(`${card.scope}:${card.group}`)) problems.push(`settings area card "${card.label}" draws "${card.group ?? ""}" at ${card.scope ?? "no scope"}, which is not one of this package's own settings (config[])`);
    }
  }
  return problems;
}

const digestCache = new WeakMap<object, string>();
/** A digest of the whole manifest (floors, pages, data, platforms, requires, settings area): an in-place edit takes effect without a version bump. */
function manifestDigest(manifest: PackageManifest): string {
  let digest = digestCache.get(manifest);
  if (!digest) {
    digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16);
    digestCache.set(manifest, digest);
  }
  return digest;
}

/** Reads and validates one package's pages. Cached on the whole manifest and every page file's size and mtime. */
function loadApp(id: string): LoadedApp | null {
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return null;
  const manifest = loaded.value;
  const contributes = (manifest.contributes ?? {}) as AppContributes;
  if (!contributes.pages || contributes.pages.length === 0) return null;
  const dir = resolvePackageDir(id);
  // The stamp covers the manifest's own page, data and floor declarations, not only the version and the page files: a floor raised in
  // the manifest must take effect without a version bump.
  const stampParts = [manifest.version, manifestDigest(manifest)];
  for (const page of contributes.pages) {
    const path = pageFile(dir, page.module);
    try {
      const stat = statSync(path);
      stampParts.push(`${page.module}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      stampParts.push(`${page.module}:missing`);
    }
  }
  const stamp = stampParts.join("|");
  const cached = loadCache.get(id);
  if (cached && cached.stamp === stamp) return cached.app;

  const pages = new Map<string, unknown>();
  const problems = checkAppPackage(id, contributes, (module) => {
    const doc = readPage(dir, module);
    if (doc === null) return { type: "unreadable" };
    if (doc !== undefined) pages.set(module, doc);
    return doc;
  }, manifest.min_role);
  for (const [module, doc] of pages) {
    if (!validateUiPage(doc)) problems.push(`pages/${module}.json does not match the UI schema: ${ajv.errorsText(validateUiPage.errors, { dataVar: "page" })}`);
  }
  problems.push(...settingsAreaProblems(manifest), ...sharedModuleProblems(contributes), ...sidebarSchemaProblems(contributes));
  if (problems.length > 0 && !warned.has(`${id}|${stamp}`)) {
    warned.add(`${id}|${stamp}`);
    console.warn(`[apps] ${id}: app refused: ${problems.join("; ")}`);
  }
  const app: LoadedApp = { manifest, contributes, pages, problems };
  loadCache.set(id, { stamp, app });
  return app;
}

// NEWS-SIDEBAR-01: a sidebar's `search`, `bind` and `open` objects are defined by the UI schema, not by the manifest schema; they are
// checked here, against the same compiled UI schema a page is, when the package loads.
const UI_SCHEMA_ID = (UI_SCHEMA as { $id: string }).$id;
function uiDef(name: "search" | "package_binding" | "action") {
  return ajv.getSchema(`${UI_SCHEMA_ID}#/$defs/${name}`);
}
function sidebarSchemaProblems(contributes: AppContributes): string[] {
  const sidebar = contributes.sidebar;
  if (!sidebar) return [];
  const out: string[] = [];
  const check = (name: "search" | "package_binding" | "action", value: unknown, at: string): void => {
    const validate = uiDef(name);
    if (!validate) { out.push(`contributes.sidebar: the UI schema has no ${name} definition`); return; }
    if (!validate(value)) out.push(`contributes.sidebar ${at} does not match the UI schema: ${ajv.errorsText(validate.errors, { dataVar: at })}`);
  };
  if (sidebar.search !== undefined) check("search", sidebar.search, "search");
  for (const group of sidebar.groups) {
    if (!group.rows) continue;
    check("package_binding", group.rows.bind, `${group.id}.rows.bind`);
    check("action", group.rows.open, `${group.id}.rows.open`);
    if (group.rows.manage) check("action", group.rows.manage.open, `${group.id}.rows.manage.open`);
  }
  return out;
}

/** The page a `navigate` action opens inside this package: `/apps/<id>` is the index, `/apps/<id>/<page>` another page; anything else is null. */
function navigateTargetPage(packageId: string, action: unknown): string | null {
  const navigate = typeof action === "object" && action !== null ? (action as { navigate?: { to?: unknown } }).navigate : undefined;
  const to = navigate?.to;
  if (typeof to !== "string") return null;
  const base = `/apps/${packageId}`;
  if (to === base) return "index";
  return to.startsWith(`${base}/`) ? (to.slice(base.length + 1).split("/")[0] ?? null) : null;
}

/** The sidebar this person may see: page entries resolved to their label and icon, and every entry, `manage` row or search whose
 * target page the person cannot open removed through `pageVisibleTo`, the one visibility check; a group left empty is dropped. */
export function sidebarFor(person: PersonRow, manifest: PackageManifest, contributes: AppContributes): AppSidebar | undefined {
  const sidebar = contributes.sidebar;
  if (!sidebar) return undefined;
  const pages = contributes.pages ?? [];
  const visible = (id: string | null): AppPageEntry | undefined => {
    const entry = id === null ? undefined : pages.find((page) => page.id === id);
    return entry && pageVisibleTo(person, manifest, entry) ? entry : undefined;
  };
  const actionVisible = (action: unknown): boolean => visible(navigateTargetPage(manifest.id, action)) !== undefined;
  const groups: AppSidebarGroup[] = [];
  for (const group of sidebar.groups) {
    if (group.pages) {
      const entries = group.pages.flatMap((id) => { const entry = visible(id); return entry ? [{ page: entry.id, label: entry.label ?? entry.id, icon: entry.icon ?? null }] : []; });
      if (entries.length > 0) groups.push({ id: group.id, ...(group.title ? { title: group.title } : {}), pages: entries });
    } else if (group.rows && actionVisible(group.rows.open)) {
      const { manage, ...rest } = group.rows;
      groups.push({ id: group.id, ...(group.title ? { title: group.title } : {}), rows: { ...rest, ...(manage && actionVisible(manage.open) ? { manage } : {}) } as AppSidebarRows });
    }
  }
  if (groups.length === 0) return undefined;
  const search = sidebar.search && typeof sidebar.search === "object" && actionVisible((sidebar.search as { submit?: unknown }).submit) ? (sidebar.search as Record<string, unknown>) : undefined;
  return { ...(search ? { search } : {}), groups };
}

/** Two page entries may not name one module file: a second entry with a lower floor would serve the raised page's document. */
function sharedModuleProblems(contributes: AppContributes): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const page of contributes.pages ?? []) {
    const first = seen.get(page.module);
    if (first !== undefined) out.push(`page "${page.id}" shares its module "${page.module}" with page "${first}"; each page needs its own file so its floor holds`);
    else seen.set(page.module, page.id);
  }
  return out;
}

/** The plain-language problems with a package's app pages, or an empty list (also for a package that is not an app).
 * Install calls this on the unpacked directory before the package becomes active. */
export function appPackageProblems(manifest: PackageManifest, dir: string): string[] {
  const contributes = (manifest.contributes ?? {}) as AppContributes;
  if (!contributes.pages || contributes.pages.length === 0) return [];
  const pages = new Map<string, unknown>();
  const problems = checkAppPackage(manifest.id, contributes, (module) => {
    const doc = readPage(dir, module);
    if (doc === null) return { type: "unreadable" };
    if (doc !== undefined) pages.set(module, doc);
    return doc;
  }, manifest.min_role);
  for (const [module, doc] of pages) {
    if (!validateUiPage(doc)) problems.push(`pages/${module}.json does not match the UI schema: ${ajv.errorsText(validateUiPage.errors, { dataVar: "page" })}`);
  }
  problems.push(...settingsAreaProblems(manifest), ...sharedModuleProblems(contributes), ...sidebarSchemaProblems(contributes));
  return problems;
}

// ---- Who may see an app --------------------------------------------------------------------

/** The one gate for the app list, a page and a data call: the person's role clears the package's `min_role`,
 * its last smoke test did not disable it, no required capability is missing, and it runs on `home`. A package
 * that fails it is absent (404 on the routes), so its existence does not leak. Age and surface gates are not
 * here and are not loosened: they stay on the data path (`resolvePlace` coarsening, `filterAnswerBlocks`). */
export function appVisibleTo(
  person: Pick<PersonRow, "role">,
  manifest: PackageManifest,
  status: { status: "enabled" | "disabled" } = getPackageStatus(manifest.id),
  unavailable: Set<string> = unavailableCapabilities(),
): boolean {
  if (!meetsMinRole(person.role, manifest.min_role)) return false;
  if (status.status !== "enabled") return false;
  if (missingRequired(manifest, unavailable).length > 0) return false;
  if (!manifest.platforms.includes("home")) return false;
  return true;
}

/** NEWS-00: a page's own floor. A page may carry `min_role` to raise the package's floor (the lint refuses a page
 * that lowers it; a role the ladder does not know fails closed to owner, so a bad value never opens a page). */
export function pageMinRole(manifest: PackageManifest, entry: AppPageEntry): string {
  const own = entry.min_role;
  if (own === undefined) return manifest.min_role;
  if (!(ROLE_LADDER as readonly string[]).includes(own)) return "owner"; // fail closed: a role the ladder does not know opens to no one but the owner
  if (!meetsMinRole(own, manifest.min_role)) return manifest.min_role; // never below the package (the install lint refuses it too)
  return own;
}

/** Page role floors, plus the News My Mix opt-out and child floor. Data still checks age at release. */
export function pageVisibleTo(person: Pick<PersonRow, "role"> & Partial<PersonRow>, manifest: PackageManifest, entry: AppPageEntry): boolean {
  if (manifest.id === "news" && entry.id === "mix") {
    if (!person.id || person.role === "guest" || person.role === "child") return false;
    if (speakerAgeBand(person as PersonRow, new Date()) === "child" || getPersonSettingValue(person as PersonRow, "news.my_mix") === false) return false;
  }
  return meetsMinRole(person.role, pageMinRole(manifest, entry));
}

/** Every string under `bind.path` (a package binding) and `call.target` found anywhere in a page document. */
function pageReferences(doc: unknown, packageId: string): { data: Set<string>; actions: Set<string> } {
  const data = new Set<string>();
  const actions = new Set<string>();
  const actionPrefix = `/api/plugins/${packageId}/actions/`;
  const walkNode = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walkNode); return; }
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    // A node's `bind`, and a `search` node's `recents` (NEWS-LOOK-02: a package binding written straight on the node).
    for (const bind of [obj.bind, obj.recents]) {
      if (typeof bind === "object" && bind !== null && (bind as Record<string, unknown>).source === "package" && typeof (bind as Record<string, unknown>).path === "string") data.add((bind as { path: string }).path);
    }
    const call = obj.call;
    if (typeof call === "object" && call !== null && typeof (call as Record<string, unknown>).target === "string") {
      const target = (call as { target: string }).target;
      // The action id is the first path segment after the prefix; a trailing segment or query string never makes a new id.
      if (target.startsWith(actionPrefix)) actions.add(target.slice(actionPrefix.length).split(/[/?#{]/)[0]!);
    }
    Object.values(obj).forEach(walkNode);
  };
  walkNode(doc);
  return { data, actions };
}

const referenceCache = new WeakMap<object, Map<string, { data: Set<string>; actions: Set<string> }>>();

/** The pages (entries) a data id or an action is reached from, by the bindings and call targets in the page documents.
 * The reference sets are computed once per loaded document (the document objects are cached by `loadApp`). */
function owningPages(app: LoadedApp, kind: "data" | "actions", id: string): AppPageEntry[] {
  return (app.contributes.pages ?? []).filter((entry) => {
    const doc = app.pages.get(entry.module);
    if (doc === undefined || typeof doc !== "object" || doc === null) return false;
    let perDoc = referenceCache.get(doc);
    if (!perDoc) { perDoc = new Map(); referenceCache.set(doc, perDoc); }
    let refs = perDoc.get(app.manifest.id);
    if (!refs) { refs = pageReferences(doc, app.manifest.id); perDoc.set(app.manifest.id, refs); }
    return refs[kind].has(id);
  });
}

/** NEWS-00: may this person reach a data id (`data`) or an action (`actions`)? It names its page through the page
 * documents; the person needs the floor of at least one page that uses it, so a call cannot reach data its page
 * hides. An id no page uses fails closed: it needs the floor of every page, so a reference this scan did not
 * recognise can never open a raised page's data to a lower role. The NEWS-02 action route must call this with
 * "actions" before it does anything. */
export function appRouteAllowed(person: PersonRow, packageId: string, kind: "data" | "actions", id: string, loaded: LoadedApp | null = visibleApp(person, packageId), unowned: "closed" | "open" = "closed"): boolean {
  const app = loaded;
  if (!app) return false;
  const owners = owningPages(app, kind, id);
  if (owners.length > 0) return owners.some((entry) => pageVisibleTo(person, app.manifest, entry));
  // An id no page names: closed to a viewer below any page, unless the caller serves ids of its own that no page document binds (the media host).
  return unowned === "open" || (app.contributes.pages ?? []).every((entry) => pageVisibleTo(person, app.manifest, entry));
}

/** NEWS-00: the picture route of an app (NEWS-02 calls it first). A picture belongs to the whole app: the person must
 * see the app, which already requires its index page. The route must still check the item is in the asker's released set. */
export function appImageAllowed(person: PersonRow, packageId: string): boolean {
  return visibleApp(person, packageId) !== null;
}

/** The role floors alone, without the app's health (lint problems, smoke status, capabilities, platform): the person clears the index page's
 * floor. `null` for a package that is not an app. */
export function appIndexFloorOk(person: PersonRow, packageId: string): boolean | null {
  const app = loadApp(packageId);
  if (!app) return null;
  const index = (app.contributes.pages ?? []).find((page) => page.id === "index");
  return !index || pageVisibleTo(person, app.manifest, index);
}

/** NEWS-00 review: the direct run route (`POST /api/plugins/:id/run`) of a package that declares pages. A package app's recipe serves
 * every page's data, so the caller needs the floor of every page: a viewer below any raised page is refused (the caller answers 404).
 * Only floors decide this; a package with no pages is not an app and is unaffected. */
export function appRunAllowed(person: PersonRow, packageId: string): boolean {
  const app = loadApp(packageId);
  if (!app) return true;
  // NEWS-03: a child may use News (kid-safe sources), but its My Mix page is teen and up. The News recipe's My Mix data answers a child
  // nothing (lib/news/data.ts returns null for a child band or a guest), so that one page does not close the whole run to a child.
  return (app.contributes.pages ?? []).every((entry) => (app.manifest.id === "news" && entry.id === "mix" && person.role === "child") || pageVisibleTo(person, app.manifest, entry));
}

/** NEWS-00 review: the manifest as one viewer may read it from `GET /api/plugins`: a package app's `contributes.pages` and `contributes.data`
 * hold only what this viewer's floors allow (a raised page and the data only it uses are not listed, nor their inputs). Floors decide this,
 * not the app's health, so an owner still sees a disabled app's declarations. */
export function manifestForViewer<T extends PackageManifest>(person: PersonRow, manifest: T): T {
  const contributes = (manifest.contributes ?? {}) as AppContributes & Record<string, unknown>;
  if (!contributes.pages || contributes.pages.length === 0) return manifest;
  const app = loadApp(manifest.id);
  if (!app || appIndexFloorOk(person, manifest.id) === false) return { ...manifest, contributes: { ...contributes, pages: [], data: [] } } as T;
  return {
    ...manifest,
    contributes: {
      ...contributes,
      pages: contributes.pages.filter((entry) => pageVisibleTo(person, manifest, entry)),
      data: (contributes.data ?? []).filter((entry) => appRouteAllowed(person, manifest.id, "data", entry.id, app)),
    },
  } as T;
}

function visibleApp(person: PersonRow, id: string): LoadedApp | null {
  const app = loadApp(id);
  if (!app || app.problems.length > 0) return null;
  if (!appVisibleTo(person, app.manifest)) return null;
  // An app whose index page is above the person is hidden as a whole (the list and search drop it), so its other pages are 404 too.
  const index = app.contributes.pages!.find((page) => page.id === "index");
  if (index && !pageVisibleTo(person, app.manifest, index)) return null;
  return app;
}

function settingsAreaFor(person: Pick<PersonRow, "role">, manifest: PackageManifest): SettingsArea | undefined {
  const area = (manifest.contributes as { settings_area?: SettingsArea } | undefined)?.settings_area;
  return area && meetsMinRole(person.role, area.audience.min_role) ? area : undefined;
}

/** Every app the asking person may open, built from the manifests on disk (no network). */
export function listApps(person: PersonRow): AppRow[] {
  const statuses = allPackageStatuses();
  const unavailable = unavailableCapabilities();
  const rows: AppRow[] = [];
  for (const id of listPackageIds()) {
    const app = loadApp(id);
    if (!app || app.problems.length > 0) continue;
    const status = statuses.get(id) ?? { status: "enabled" as const };
    if (!appVisibleTo(person, app.manifest, status, unavailable)) continue;
    const index = app.contributes.pages!.find((page) => page.id === "index")!;
    if (index.nav === false) continue;
    if (!pageVisibleTo(person, app.manifest, index)) continue;
    const manifest = app.manifest;
    rows.push({
      package: id,
      page: "index",
      label: index.label ?? (typeof manifest.display === "string" && manifest.display.trim() ? manifest.display : id),
      icon: index.icon ?? "layout-grid",
      description: manifest.description,
      category: manifest.category,
      keywords: index.keywords ?? [],
      ...(sidebarFor(person, manifest, app.contributes) ? { sidebar: sidebarFor(person, manifest, app.contributes)! } : {}),
      sections: app.contributes.pages!.filter((page) => page.id !== "index" && page.nav && pageVisibleTo(person, manifest, page)).map((page: AppPageEntry) => ({ page: page.id, label: page.label ?? page.id, icon: page.icon ?? null })),
      to: `/apps/${id}`,
      incognito: manifest.incognito,
      ...(index.pinned_by_default ? { pinned_by_default: true } : {}),
      ...(typeof index.pin_order === "number" ? { pin_order: index.pin_order } : {}),
      // The package's own settings area, as declared, for the person's role only (the shell draws it at /settings/<id>).
      ...(settingsAreaFor(person, manifest) ? { settings_area: settingsAreaFor(person, manifest)! } : {}),
    });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** One page document of a visible app. */
export function getAppPage(person: PersonRow, packageId: string, pageId: string): AppResult<unknown> {
  const app = visibleApp(person, packageId);
  if (!app) return NOT_FOUND;
  const entry = app.contributes.pages!.find((page) => page.id === pageId);
  const doc = entry ? app.pages.get(entry.module) : undefined;
  if (!entry || doc === undefined || !pageVisibleTo(person, app.manifest, entry)) return { ok: false, status: 404, error: "no such page" };
  return { ok: true, status: 200, value: doc };
}

// ---- The data call -------------------------------------------------------------------------

/** The rows a place picker lists: the household home first (when it is set and this person can read it), then the
 * person's own saved places. Nobody sees another person's places: each id is read back through `getEntity(person, ...)`,
 * which refuses what the asker may not see. A place that is both the home and a saved place is listed once. */
function savedPlaceRows(person: PersonRow, surface: string): Array<{ id: string; label: string }> {
  const rows: Array<{ id: string; label: string }> = [];
  const homeId = getHouseholdSettingValue("household.home");
  if (typeof homeId === "string") {
    const home = getEntity(person, homeId);
    if (home.ok && home.value?.kind === "place" && home.value.scope === "household") rows.push({ id: home.value.id, label: `${home.value.name} (home)` });
  }
  const raw = getPersonSettingValue(person, `${surface}.places`);
  const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  for (const id of ids) {
    if (rows.some((row) => row.id === id)) continue;
    const found = getEntity(person, id);
    if (found.ok && found.value?.kind === "place") rows.push({ id: found.value.id, label: found.value.name });
  }
  return rows;
}

function timedOut(code: string | undefined): boolean {
  return code === "timeout" || code === "deadline_exceeded";
}

/** `POST /api/plugins/:id/data/:dataId`. `body.place` is a saved place id (from this person's rows), the word
 * "current", or absent for the person's default; `body.current` is `{lat, lon, area?}`, used only with "current".
 * Coordinates are consumed in this call: never stored, logged, cached by text or echoed. */
export async function getAppData(person: PersonRow, packageId: string, dataId: string, body: unknown, run: typeof runPlugin = runPlugin): Promise<AppResult<AppData>> {
  const app = visibleApp(person, packageId);
  if (!app) return NOT_FOUND;
  const entry: AppDataEntry | undefined = app.contributes.data?.find((d) => d.id === dataId);
  if (!entry || !appRouteAllowed(person, packageId, "data", dataId, app)) return { ok: false, status: 404, error: "no such data" };
  const asOf = new Date().toISOString();
  if (entry.rows === "places") return { ok: true, status: 200, value: { as_of: asOf, rows: entry.surface ? savedPlaceRows(person, entry.surface) : [] } };

  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const chosen = typeof input.place === "string" && input.place.trim() ? input.place.trim() : null;
  const current = chosen === "current" ? parseCurrentLocation(input.current) : null;
  // A saved place is named by its id in the picker. Anything that is not a place this person can see is refused,
  // so the id of another person's place is never a way to read it.
  let named: string | null = null;
  if (chosen && chosen !== "current") {
    const found = getEntity(person, chosen);
    if (!found.ok || found.value?.kind !== "place") return { ok: false, status: 400, error: "That place is not one of yours. Choose another." };
    named = found.value!.name;
  }
  if (chosen === "current" && !current) return { ok: false, status: 400, error: "Location was not shared. Choose a saved place instead.", kind: "needs_place" };

  const inputs: Record<string, unknown> = { ...((entry.inputs ?? {}) as Record<string, unknown>) };
  let hostInputs: Record<string, unknown> | undefined;
  let uncached = false;
  if (entry.surface === "weather") {
    let place = await resolveWeatherPlace({ person, named, current, preferCurrent: current !== null });
    // WEATHER-FIX-01: the app page was asked for the person's default, the default is Current location, the browser
    // shared nothing and there is no household home. A saved place still answers: the first one the person saved.
    if (!place && !chosen) {
      const first = savedPlaceRows(person, "weather").find((row) => !row.label.endsWith("(home)"));
      const saved = first ? getEntity(person, first.id) : null;
      if (saved?.ok && saved.value?.kind === "place") place = await resolveWeatherPlace({ person, named: saved.value.name });
    }
    if (!place) return { ok: true, status: 200, value: { as_of: asOf, blocks: [], needs: "place" } };
    inputs.place = place.place;
    hostInputs = place.hostInputs;
    uncached = place.uncached;
  }
  const result = await run(packageId, person, inputs, undefined, { ...(hostInputs ? { hostInputs, uncached } : {}) });
  if (!result.ok) {
    // Only the kind of failure reaches the page, never the raw error (rule 6, rule 6a).
    if (timedOut((result as { code?: string }).code)) return { ok: false, status: 502, error: "The lookup took too long.", kind: "timed_out" };
    return { ok: false, status: 502, error: "The lookup did not work right now.", kind: "down" };
  }
  // The one output boundary (CHAT-02): a package answer that fails it shows nothing, as in chat.
  if (refusePackageReplyIfUnsafe(person, result.value)) return { ok: true, status: 200, value: { as_of: asOf, blocks: [] } };
  if ((result.value.data as { needs?: string } | undefined)?.needs === "place") return { ok: true, status: 200, value: { as_of: asOf, blocks: [], needs: "place" } };
  const raw = (result.value as typeof result.value & { blocks?: unknown }).blocks;
  const blocks = Array.isArray(raw) ? filterAnswerBlocks(raw, packageId, app.manifest.returns_blocks ?? [], speakerAgeBand(person, new Date()), person) : [];
  return { ok: true, status: 200, value: { as_of: asOf, blocks } };
}

export function __resetAppCachesForTests(): void {
  loadCache.clear();
  warned.clear();
}
