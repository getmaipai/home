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

import type { AppRow, AppSection } from "../wire";
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

/** Reads and validates one package's pages. Cached on the manifest and every page file's size and mtime. */
function loadApp(id: string): LoadedApp | null {
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return null;
  const manifest = loaded.value;
  const contributes = (manifest.contributes ?? {}) as AppContributes;
  if (!contributes.pages || contributes.pages.length === 0) return null;
  const dir = resolvePackageDir(id);
  const stampParts = [manifest.version];
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
  problems.push(...settingsAreaProblems(manifest));
  if (problems.length > 0 && !warned.has(`${id}|${stamp}`)) {
    warned.add(`${id}|${stamp}`);
    console.warn(`[apps] ${id}: app refused: ${problems.join("; ")}`);
  }
  const app: LoadedApp = { manifest, contributes, pages, problems };
  loadCache.set(id, { stamp, app });
  return app;
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
  problems.push(...settingsAreaProblems(manifest));
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
 * that lowers it; a role the ladder does not know falls back to the package's, so a bad value never opens a page). */
export function pageMinRole(manifest: PackageManifest, entry: AppPageEntry): string {
  const own = entry.min_role;
  if (own === undefined) return manifest.min_role;
  if (!(ROLE_LADDER as readonly string[]).includes(own)) return "owner"; // fail closed: a role the ladder does not know opens to no one but the owner
  if (!meetsMinRole(own, manifest.min_role)) return manifest.min_role; // never below the package (the install lint refuses it too)
  return own;
}

/** Whether the person's role clears one page's floor. Role only: age stays on the data path. */
export function pageVisibleTo(person: Pick<PersonRow, "role">, manifest: PackageManifest, entry: AppPageEntry): boolean {
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
    const bind = obj.bind;
    if (typeof bind === "object" && bind !== null && (bind as Record<string, unknown>).source === "package" && typeof (bind as Record<string, unknown>).path === "string") data.add((bind as { path: string }).path);
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
 * hides. An id no page uses keeps only the package's floor (a widget's data id, say). */
export function appRouteAllowed(person: PersonRow, packageId: string, kind: "data" | "actions", id: string, loaded: LoadedApp | null = visibleApp(person, packageId)): boolean {
  const app = loaded;
  if (!app) return false;
  const owners = owningPages(app, kind, id);
  return owners.length === 0 || owners.some((entry) => pageVisibleTo(person, app.manifest, entry));
}

/** NEWS-00: the action and image forms have no caller until NEWS-02 adds `/actions/:action` and `/images/:item`; each of
 * those routes must call `appRouteAllowed(..., "actions", id)` and `appImageAllowed` first (the data form is wired in `getAppData`).
 * The picture route of an app. A picture belongs to the whole app, so the person needs the floor of at
 * least one of its pages. */
export function appImageAllowed(person: PersonRow, packageId: string): boolean {
  const app = visibleApp(person, packageId);
  return !!app && (app.contributes.pages ?? []).some((entry) => pageVisibleTo(person, app.manifest, entry));
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
