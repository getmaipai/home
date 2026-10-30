import { listHelperApps, type HelperListing } from "@/lib/appHelperClient";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { StackDevLoad } from "@/lib/stack/types";

/** MEM-SPACE-03: what else on this Mac is using memory, for admins on the Status page. One source per install state: the Mac app helper when it is installed, otherwise the Stack's dev-load reading, never both. No new poller, nothing stored or logged, no process signalled. */
export interface OtherApp { name: string; bytes: number }
export interface OtherApps { source: "helper" | "stack" | "none"; apps: OtherApp[] }

const GB = 1024 ** 3;
/** Only an app that holds a gigabyte or more is worth a line; the three biggest are named. */
const MIN_BYTES = GB;
const MAX_LINES = 3;
const topApps = (apps: OtherApp[]) => apps.filter((app) => app.bytes >= MIN_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, MAX_LINES);

export async function readOtherApps(readers: { helper?: () => Promise<HelperListing>; stack?: () => Promise<StackDevLoad | undefined> } = {}): Promise<OtherApps> {
  const helper = await (readers.helper ?? (() => listHelperApps()))();
  if (helper.installed) {
    // The helper lists every running app, including MaiPai's own and the operating system's; neither is "another app".
    return { source: "helper", apps: topApps(helper.apps.filter((app) => !/^(ai|com)\.maipai\./i.test(app.bundleId) && !app.bundleId.startsWith("com.apple.finder") && app.bundleId !== "com.apple.dock" && app.bundleId !== "com.apple.WindowServer").map((app) => ({ name: app.name, bytes: app.bytes }))) };
  }
  const load = await (readers.stack ?? defaultStackReader)().catch(() => undefined);
  if (load && Array.isArray(load.processes)) return { source: "stack", apps: topApps(load.processes.filter((row) => typeof row.name === "string" && Number.isFinite(row.bytes)).map((row) => ({ name: row.name, bytes: row.bytes }))) };
  return { source: "none", apps: [] };
}

async function defaultStackReader(): Promise<StackDevLoad | undefined> {
  if (!isStackConfigured()) return undefined;
  return (await getStackClient().memory?.())?.dev_load;
}
