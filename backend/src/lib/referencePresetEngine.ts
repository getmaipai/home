import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import presetsVocab from "@maipai/spec/vocab/reference-presets.json";
import { Referencelibrarypresets } from "@maipai/spec/gen/ts/reference-presets.js";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { referenceLibraryDir, resolveReferenceLibraryLocation } from "@/lib/kiwixSidecar";
import { installAndPublishReferenceFlavour, listInstalledReferenceFlavours, removeInstalledReferenceFlavour, resolveReferenceFlavour } from "@/lib/referenceLibrary";
import { sourceById, sourceForBook, BAND_SOURCE_IDS } from "@/lib/retrieval/referenceSources";
import { diskUsage } from "@/lib/storage";
import { newJobId } from "@/lib/id";
import type { DownloadProgress } from "@/lib/modelDownload";

const presetLibrary = Referencelibrarypresets.parse(presetsVocab);
let catalogUrlOverride: string | undefined;
export function __setReferenceCatalogUrlForTests(url?: string): void { catalogUrlOverride = url; }
export type PresetId = "minimum" | "moderate" | "full";
export type Selection = { source: string; flavour: "mini" | "maxi" | "nopic" | "default" }[];
type SetSpec = { source: string; flavour: string; book: string; language: string; catalogFlavour: string; child: boolean; wikipedia: boolean };
export type PlannedSet = { id: string; source: string; flavour: string; name: string; snapshotDate: string | null; sizeBytes: number; sha256: string; installed: boolean; child: boolean; wikipedia: boolean };
export type ReferencePlan = { preset: PresetId | "custom"; sets: PlannedSet[]; totalBytes: number; freeBytes: number; freeAfterInstallBytes: number; requiredFreeBytes: number; refusal: string | null; swapHeadroomBytes: number; estimatedSeconds: number | null; warnings: string[]; settings: Record<string, string | number | boolean> };
export type ReferenceJob = { id: string; setId: string; state: "queued" | "waiting_window" | "downloading" | "paused" | "done" | "failed" | "cancelled"; completedBytes: number; totalBytes: number; message: string | null; /** Set when you press Apply or Start now: this job ignores the nightly window. */ force?: boolean };
type StateFile = { jobs: ReferenceJob[]; order: string[]; selection: Selection; settings: Record<string, string | number | boolean>; location?: string };
const statePath = () => join(referenceLibraryDir(), ".reference-jobs.json");
const knownSources = new Set(["vikidia", "wikipedia-simple", "wikipedia-en", "wiktionary-simple", "wiktionary-en", "wikivoyage", "wikibooks", "world-factbook", "medlineplus", "stackexchange"]);
// `book` is the catalogue's exact book name (never a loose prefix: "wikipedia_" once matched the Football-only edition),
// so every source keeps its own slot. An empty flavour is a book Kiwix publishes in one build only.
const sourceMap: Record<string, { book: string; language: string; flavor: string }> = {
  // ZIM-IMG-01: picture builds, so answers can show the library's own pictures.
  vikidia: { book: "vikidia_en_all", language: "eng", flavor: "maxi" },
  "wikipedia-simple": { book: "wikipedia_en-simple_all", language: "eng", flavor: "maxi" },
  "wikipedia-en": { book: "wikipedia_en_all", language: "eng", flavor: "mini" },
  "wiktionary-simple": { book: "wiktionary_en-simple_all", language: "eng", flavor: "nopic" },
  "wiktionary-en": { book: "wiktionary_en_all", language: "eng", flavor: "nopic" },
  wikivoyage: { book: "wikivoyage_en_all", language: "eng", flavor: "maxi" },
  wikibooks: { book: "wikibooks_en_all", language: "eng", flavor: "maxi" },
  "world-factbook": { book: "theworldfactbook_en_all", language: "eng", flavor: "" },
  medlineplus: { book: "medlineplus.gov_en_all", language: "eng", flavor: "" },
  // Kiwix publishes Stack Exchange as one book per site, so there is no single book to offer yet.
  stackexchange: { book: "stackexchange", language: "eng", flavor: "maxi" },
};
function setSpec(source: string, flavour: string): SetSpec {
  const base = sourceMap[source];
  if (!base || !knownSources.has(source)) throw new Error(`Unknown reference set: ${source}`);
  return { source, flavour, book: base.book, language: base.language, catalogFlavour: flavour === "default" ? base.flavor : flavour, child: ["vikidia", "wikipedia-simple", "wiktionary-simple", "wikivoyage", "world-factbook"].includes(source), wikipedia: source === "wikipedia-en" || source === "wikipedia-simple" };
}
function selectionFor(preset: PresetId | "custom", custom?: Selection): Selection {
  if (preset === "custom") return custom ?? [];
  const row = presetLibrary.presets.find((p) => p.id === preset);
  if (!row) throw new Error("Unknown reference preset");
  return row.members.map((m) => ({ source: m.source, flavour: m.flavour }));
}
function loadState(): StateFile {
  try {
    const row = JSON.parse(readFileSync(statePath(), "utf8")) as StateFile;
    if (Array.isArray(row.jobs) && Array.isArray(row.order) && Array.isArray(row.selection)) {
      let changed = false;
      for (const job of row.jobs) if (job.state === "downloading") { job.state = "queued"; job.message = null; changed = true; }
      if (changed) saveState(row);
      return row;
    }
  } catch { /* first run or incomplete state: start empty */ }
  return { jobs: [], order: [], selection: [], settings: {} };
}
function saveState(state: StateFile): void {
  mkdirSync(referenceLibraryDir(), { recursive: true });
  const path = statePath();
  const incoming = `${path}.incoming`;
  writeFileSync(incoming, JSON.stringify(state), { mode: 0o600 });
  renameSync(incoming, path);
}
function currentSetting(key: string, fallback: unknown): unknown { return getHouseholdSettingValue(key) ?? fallback; }
function inWindow(now = new Date()): boolean {
  const from = String(currentSetting("household.quiet_hours.from", "21:00"));
  const to = String(currentSetting("household.quiet_hours.to", "07:00"));
  const m = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null;
  const a = m(from); const b = m(to);
  if (a === null || b === null || a === b) return false;
  const local = now.getHours() * 60 + now.getMinutes();
  return a < b ? local >= a && local < b : local >= a || local < b;
}

export async function planReference(preset: PresetId | "custom", custom?: Selection, location?: string): Promise<ReferencePlan> {
  const chosen = selectionFor(preset, custom);
  const dedup = [...new Map(chosen.map((item) => [`${item.source}:${item.flavour}`, item])).values()];
  const specs = dedup.map((row) => setSpec(row.source, row.flavour));
  const installed = listInstalledReferenceFlavours();
  const skipped: string[] = [];
  const rows = (await Promise.all(specs.map(async (spec) => {
    let resolved: Awaited<ReturnType<typeof resolveReferenceFlavour>>;
    try { resolved = await resolveReferenceFlavour(spec.book, spec.language, spec.catalogFlavour, catalogUrlOverride); } catch { skipped.push(sourceById(spec.source)?.label ?? spec.source); return null; }
    const source = sourceById(spec.source);
    return { id: `${spec.source}:${spec.flavour}`, source: spec.source, flavour: spec.flavour, name: resolved.name, snapshotDate: resolved.snapshotDate, sizeBytes: resolved.sizeBytes, sha256: resolved.sha256, installed: installed.some((i) => i.book === spec.book && i.language === spec.language && i.flavour === spec.catalogFlavour), child: spec.child, wikipedia: spec.wikipedia, label: source?.label ?? spec.source } satisfies PlannedSet & { label: string };
  }))).filter((row): row is NonNullable<typeof row> => row !== null);
  const totalBytes = rows.reduce((sum, row) => sum + (row.installed ? 0 : row.sizeBytes), 0);
  const dir = resolveReferenceLibraryLocation(location);
  const disk = diskUsage(dir);
  const freeAfterInstallBytes = disk.freeBytes - totalBytes;
  const requiredFreeBytes = Math.ceil(disk.freeBytes * 0.2);
  const refusal = freeAfterInstallBytes < requiredFreeBytes ? "There will not be enough free disk space after this download. Keep at least 20 percent of the drive free." : null;
  const swapHeadroomBytes = rows.reduce((sum, row) => sum + (!row.installed && installed.some((i) => i.name === row.name) ? row.sizeBytes : 0), 0);
  const mbps = Number(currentSetting("reference.update.max_mbps", 20));
  const estimatedSeconds = mbps > 0 ? Math.ceil(totalBytes / (mbps * 1_000_000)) : null;
  const warnings: string[] = [];
  if (skipped.length) warnings.push(`${[...new Set(skipped)].join(", ")} cannot be downloaded right now because the Kiwix library does not list it, so it is left out.`);
  if (rows.some((row) => row.child)) warnings.push("Some sets are designed for children; their articles still follow each child's search protections.");
  if (rows.some((row) => row.wikipedia)) warnings.push("The offline Wikipedia snapshot can be weeks old; live Wikipedia search may still find newer information.");
  if (currentSetting("search.source_mode", "mix") === "offline" && !rows.some((row) => row.source === "wikipedia-en" || row.source === "wikipedia-simple")) warnings.push("Live Wikipedia search is off and no Wikipedia set is selected, so Wikipedia results will not be available.");
  const settings = preset === "custom" ? {} : { ...presetLibrary.presets.find((p) => p.id === preset)!.settings };
  return { preset, sets: rows.map(({ label: _label, ...row }) => row), totalBytes, freeBytes: disk.freeBytes, freeAfterInstallBytes, requiredFreeBytes, refusal, swapHeadroomBytes, estimatedSeconds, warnings, settings };
}

/** Catalogue view for the admin settings page. Resolves live metadata from
 * Kiwix and reports only sets whose installed files Home itself owns. */
export async function listReferenceCatalog() {
  const installed = listInstalledReferenceFlavours();
  const choices: Selection = [
    { source: "vikidia", flavour: "default" }, { source: "wikipedia-simple", flavour: "default" },
    { source: "wikipedia-en", flavour: "mini" }, { source: "wikipedia-en", flavour: "nopic" }, { source: "wikipedia-en", flavour: "maxi" },
    { source: "wiktionary-simple", flavour: "default" }, { source: "wiktionary-en", flavour: "default" },
    { source: "wikivoyage", flavour: "default" }, { source: "wikibooks", flavour: "default" },
    { source: "world-factbook", flavour: "default" }, { source: "medlineplus", flavour: "default" },
  ];
  return Promise.all(choices.map(async (choice) => {
    const spec = setSpec(choice.source, choice.flavour);
    const own = installed.find((row) => row.book === spec.book && row.language === spec.language && row.flavour === spec.catalogFlavour);
    const bands = choice.source === "medlineplus" ? ["adult"] : ["child", "teen", "adult"];
    try {
      const resolved = await resolveReferenceFlavour(spec.book, spec.language, spec.catalogFlavour, catalogUrlOverride);
      return { id: `${choice.source}:${choice.flavour}`, source: choice.source, flavour: choice.flavour, name: resolved.name, language: resolved.language, sizeBytes: own ? statSync(join(referenceLibraryDir(), `${own.name}_${own.flavour}.zim`)).size : resolved.sizeBytes, snapshotDate: own?.snapshotDate ?? resolved.snapshotDate, installed: Boolean(own), child: spec.child, wikipedia: spec.wikipedia, bands, available: true, message: null };
    } catch {
      return { id: `${choice.source}:${choice.flavour}`, source: choice.source, flavour: choice.flavour, name: `${spec.book} (${choice.flavour})`, language: spec.language, sizeBytes: own ? statSync(join(referenceLibraryDir(), `${own.name}_${own.flavour}.zim`)).size : 0, snapshotDate: own?.snapshotDate ?? null, installed: Boolean(own), child: spec.child, wikipedia: spec.wikipedia, bands, available: false, message: "This set is not available in the current Kiwix catalogue." };
    }
  }));
}

let runner = false;
let windowTimer: ReturnType<typeof setTimeout> | null = null;
const controllers = new Map<string, AbortController>();
export function getReferenceState() {
  const state = loadState();
  const installed = listInstalledReferenceFlavours();
  const installedIds = new Set(installed.flatMap((i) => {
    const source = REFERENCE_SOURCE_BY_BOOK(i.book);
    if (!source) return [];
    return presetLibrary.presets.flatMap((p) => p.members.filter((m) => m.source === source && setSpec(m.source, m.flavour).catalogFlavour === i.flavour).map((m) => `${m.source}:${m.flavour}`));
  }));
  const matches = presetLibrary.presets.filter((p) => p.members.every((m) => installedIds.has(`${m.source}:${m.flavour}`))).map((p) => p.id);
  return { installed, jobs: state.jobs.filter((j) => ["queued", "waiting_window", "downloading", "paused"].includes(j.state)), matchesPresets: matches };
}
function REFERENCE_SOURCE_BY_BOOK(book: string): string | null { return sourceForBook(book)?.id ?? null; }
export async function applyReference(preset: PresetId | "custom", custom?: Selection, location?: string): Promise<{ jobs: ReferenceJob[]; idempotent: boolean }> {
  const plan = await planReference(preset, custom, location);
  if (plan.refusal) throw new Error(plan.refusal);
  const selection = selectionFor(preset, custom);
  const prior = loadState();
  const same = JSON.stringify([...selection].sort((a,b)=>`${a.source}:${a.flavour}`.localeCompare(`${b.source}:${b.flavour}`))) === JSON.stringify([...prior.selection].sort((a,b)=>`${a.source}:${a.flavour}`.localeCompare(`${b.source}:${b.flavour}`)));
  if (same && prior.location === resolveReferenceLibraryLocation(location) && prior.jobs.every((j) => ["queued", "waiting_window", "downloading", "paused", "done"].includes(j.state))) return { jobs: prior.jobs, idempotent: true };
  const settings = { ...plan.settings, "search.source_mode": plan.settings["search.source_mode"] ?? "mix" };
  for (const [key, value] of Object.entries(settings)) {
    const result = setHouseholdSettingValue(key, value);
    if (!result.ok) throw new Error(result.error);
  }
  const childFirst = new Set(preset === "custom" ? selection.filter((m) => BAND_SOURCE_IDS.child.includes(m.source)).map((m) => `${m.source}:${m.flavour}`) : presetLibrary.presets.find((p) => p.id === preset)!.members.filter((m) => m.bands.includes("child")).map((m) => `${m.source}:${m.flavour}`));
  const order = selection.map((r) => setSpec(r.source, r.flavour)).sort((a,b) => Number(a.wikipedia) - Number(b.wikipedia) || Number(childFirst.has(`${b.source}:${b.flavour}`)) - Number(childFirst.has(`${a.source}:${a.flavour}`))).map((s) => `${s.source}:${s.flavour}`);
  const byId = new Map(plan.sets.map((s) => [s.id, s]));
  const jobs: ReferenceJob[] = order.map((id) => byId.get(id)).filter((s): s is PlannedSet => Boolean(s && !s.installed)).map((s) => ({ id: newJobId(), setId: s.id, state: "queued", completedBytes: 0, totalBytes: s.sizeBytes, message: null, force: true }));
  saveState({ jobs, order, selection, settings, location: resolveReferenceLibraryLocation(location) });
  void runQueue();
  return { jobs, idempotent: false };
}
async function runQueue(): Promise<void> {
  if (runner) return;
  runner = true;
  try {
    while (true) {
      const state = loadState();
      const job = state.jobs.find((j) => j.state === "queued" || j.state === "waiting_window");
      if (!job) break;
      if (!job.force && currentSetting("reference.download.when", "window") === "window" && !inWindow()) {
        job.state = "waiting_window"; job.message = "Waiting for the nightly download window."; saveState(state);
        if (windowTimer) clearTimeout(windowTimer);
        windowTimer = setTimeout(() => { windowTimer = null; void runQueue(); }, 60_000);
        break;
      }
      job.state = "downloading"; job.message = "Downloading"; saveState(state);
      const [source, flavour] = job.setId.split(":");
      const spec = setSpec(source!, flavour!);
      const abort = new AbortController(); controllers.set(job.id, abort);
      try {
        await installAndPublishReferenceFlavour(spec.book, spec.language, spec.catalogFlavour, { signal: abort.signal, location: state.location ?? resolveReferenceLibraryLocation(), maxBytesPerSecond: Number(currentSetting("reference.update.max_mbps", 20)) * 1_000_000, onProgress: (progress: DownloadProgress) => {
          const live = loadState(); const row = live.jobs.find((j) => j.id === job.id); if (!row) return;
          row.completedBytes = progress.completedBytes; row.totalBytes = progress.totalBytes; row.message = progress.status; saveState(live);
        } });
        const live = loadState(); const row = live.jobs.find((j) => j.id === job.id); if (row) { row.state = "done"; row.completedBytes = row.totalBytes; row.message = null; saveState(live); }
      } catch (error) {
        const live = loadState(); const row = live.jobs.find((j) => j.id === job.id); if (row) {
          row.state = abort.signal.aborted ? (row.state === "cancelled" ? "cancelled" : "paused") : "failed";
          row.message = abort.signal.aborted ? null : (error instanceof Error ? error.message : "Download failed"); saveState(live);
        }
      } finally { controllers.delete(job.id); }
    }
  } finally { runner = false; }
}

/** Called during server boot. Durable queued jobs (including jobs marked
 * downloading when the process died) resume through downloadUrl's .part
 * Range support, and the window gate is rechecked before each start. */
export function resumeReferenceJobsOnBoot(): void { void runQueue(); }
export function controlReferenceJob(id: string, action: "pause" | "resume" | "cancel"): ReferenceJob | null {
  const state = loadState(); const job = state.jobs.find((j) => j.id === id); if (!job) return null;
  if (action === "pause" || action === "cancel") { if (action === "cancel") job.state = "cancelled"; else job.state = "paused"; controllers.get(id)?.abort(); }
  else if (["paused", "waiting_window"].includes(job.state)) { if (job.state === "waiting_window") job.force = true; job.state = "queued"; void runQueue(); }
  saveState(state); return job;
}
export async function installOneReference(source: string, flavour: string, location?: string): Promise<ReferenceJob> {
  const plan = await planReference("custom", [{ source, flavour: flavour as Selection[number]["flavour"] }], location);
  if (plan.refusal) throw new Error(plan.refusal);
  const result = await applyReference("custom", [{ source, flavour: flavour as Selection[number]["flavour"] }], location);
  return result.jobs[0] ?? { id: "", setId: `${source}:${flavour}`, state: "done", completedBytes: 0, totalBytes: 0, message: null };
}
export async function removeOneReference(id: string) { return removeInstalledReferenceFlavour(id); }

/** The drive the books live on: its size, what is free, and what the installed books use (the numbers behind the Offline data disk bar). */
export function referenceDisk(location?: string): { totalBytes: number; freeBytes: number; booksBytes: number } {
  const dir = resolveReferenceLibraryLocation(location);
  const disk = diskUsage(dir);
  const booksBytes = listInstalledReferenceFlavours().reduce((sum, row) => { try { return sum + statSync(join(dir, `${row.name}_${row.flavour}.zim`)).size; } catch { return sum; } }, 0);
  const finite = (n: number) => Number.isFinite(n) ? n : 0;
  return { totalBytes: finite(disk.totalBytes), freeBytes: finite(disk.freeBytes), booksBytes };
}
