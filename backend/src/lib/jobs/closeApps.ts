import { listHelperApps, quitHelperApp, reopenHelperApp, type HelperApp, type HelperQuit } from "@/lib/appHelperClient";

// MEM-SPACE-10/11: the close step of the live-fit ladder (docs/design/auto-close-apps-2026-10-30.md section 3). App names live in this
// module's memory for the life of the job and are read only by the admin Status line; the job record gets counts and bytes (rule 6a).

export interface CloseSettings { mode: "off" | "automatic"; always: string[]; never: string[]; reopen: boolean; noReopen: string[] }
export interface CloseHelper {
  list: () => Promise<{ installed: boolean; apps: HelperApp[] }>;
  quit: (bundleId: string, waitSeconds: number) => Promise<HelperQuit>;
  reopen: (bundleId: string) => Promise<boolean>;
}
export const realHelper: CloseHelper = { list: () => listHelperApps(), quit: (id, wait) => quitHelperApp(id, wait), reopen: (id) => reopenHelperApp(id) };

const RECENT_MS = 2 * 60_000;
const lastFrontmost = new Map<string, number>();

function parseIds(raw: unknown): string[] {
  try { const parsed = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
export function closeSettingsFrom(read: (key: string) => unknown): CloseSettings {
  return {
    mode: read("resources.close_apps.mode") === "automatic" ? "automatic" : "off",
    always: parseIds(read("resources.close_apps.always")),
    never: parseIds(read("resources.close_apps.never")),
    reopen: read("resources.close_apps.reopen") !== false,
    noReopen: parseIds(read("resources.close_apps.no_reopen")),
  };
}

/** The apps that may be closed now, in the order they are tried: listed, not on Never, not in front, not used in the last two minutes. Biggest first. */
export function closableApps(apps: readonly HelperApp[], settings: CloseSettings, now: number): HelperApp[] {
  for (const app of apps) if (app.frontmost) lastFrontmost.set(app.bundleId, now);
  const always = new Set(settings.always);
  const never = new Set(settings.never);
  return apps.filter((app) => always.has(app.bundleId) && !never.has(app.bundleId) && !app.frontmost && now - (lastFrontmost.get(app.bundleId) ?? -Infinity) > RECENT_MS && app.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/** The smallest set, biggest first, that covers the shortfall; null when the listed apps together cannot cover it (nothing is closed for nothing). */
export function pickSmallestSet(candidates: readonly HelperApp[], shortfallBytes: number): HelperApp[] | null {
  const picked: HelperApp[] = [];
  let total = 0;
  for (const app of candidates) {
    if (total >= shortfallBytes) break;
    picked.push(app); total += app.bytes;
  }
  return total >= shortfallBytes ? picked : null;
}

interface ClosedRecord { closed: { bundleId: string; name: string; bytes: number }[]; refused: { name: string }[]; reopened: string[]; kindWords: string; done: boolean }
const closedByJob = new Map<string, ClosedRecord>();

export interface CloseResult { closedApps: number; closedBytes: number }

/** Quits the smallest listed set that covers `shortfallGb`, waits up to 20 s each, remembers names for the job. Returns counts for the job record. */
export async function closeForJob(jobId: string, kindWords: string, shortfallGb: number, settings: CloseSettings, helper: CloseHelper = realHelper, now = Date.now()): Promise<CloseResult> {
  const none: CloseResult = { closedApps: 0, closedBytes: 0 };
  if (settings.mode !== "automatic" || settings.always.length === 0 || shortfallGb <= 0) return none;
  const listing = await helper.list();
  if (!listing.installed) return none;
  const picked = pickSmallestSet(closableApps(listing.apps, settings, now), shortfallGb * 1e9);
  if (!picked) return none;
  const record = closedByJob.get(jobId) ?? { closed: [], refused: [], reopened: [], kindWords, done: false };
  for (const app of picked) {
    const outcome = await helper.quit(app.bundleId, 20);
    if (outcome === "quit") record.closed.push({ bundleId: app.bundleId, name: app.name, bytes: app.bytes });
    else if (outcome === "still_running") record.refused.push({ name: app.name });
  }
  if (record.closed.length > 0 || record.refused.length > 0) closedByJob.set(jobId, record);
  return { closedApps: record.closed.length, closedBytes: record.closed.reduce((sum, app) => sum + app.bytes, 0) };
}

/** At the job's end: reopen once, in the order closed, unless reopening is off for everything or for that app. An app the person already opened is left alone by the helper. */
export async function reopenForJob(jobId: string, settings: CloseSettings, helper: CloseHelper = realHelper): Promise<void> {
  const record = closedByJob.get(jobId);
  if (!record) return;
  if (settings.reopen) {
    const skip = new Set(settings.noReopen);
    for (const app of record.closed) if (!skip.has(app.bundleId) && await helper.reopen(app.bundleId)) record.reopened.push(app.name);
  }
  record.done = true;
  const finished = [...closedByJob.entries()].filter(([, item]) => item.done);
  for (const [id] of finished.slice(0, Math.max(0, finished.length - 3))) closedByJob.delete(id);
}

const join = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
/** MEM-SPACE-11: the admin-only Status line, read live while a job runs and for a short while after. Names appear here and nowhere else. */
export function closedAppsLines(): string[] {
  const lines: string[] = [];
  for (const record of closedByJob.values()) {
    const { done, kindWords: words } = record;
    if (record.closed.length > 0) {
      const gb = Math.round(record.closed.reduce((sum, app) => sum + app.bytes, 0) / 1e9);
      lines.push(record.reopened.length > 0 ? `Closed ${join(record.closed.map((app) => app.name))} (about ${gb} GB) for the ${words}. Reopened ${join(record.reopened)}.` : done ? `Closed ${join(record.closed.map((app) => app.name))} (about ${gb} GB) for the ${words}. Not reopened.` : `Closed ${join(record.closed.map((app) => app.name))} to make room (about ${gb} GB). They reopen when the ${words} is done.`);
    }
    for (const app of record.refused) lines.push(`${app.name} asked to save, so it was left open.`);
  }
  return lines;
}
/** Jobs that closed apps and have not yet reopened them. */
export function jobsAwaitingReopen(): string[] { return [...closedByJob.entries()].filter(([, record]) => !record.done).map(([id]) => id); }
export function resetCloseAppsForTests(): void { closedByJob.clear(); lastFrontmost.clear(); }
