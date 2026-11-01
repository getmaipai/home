// MEM-SPACE-08: installs the Mac app helper from the Close apps card and the setup wizard. The one definition of how is scripts/app-helper.sh
// (user-level LaunchAgent, built on this Mac, no privileges, `remove` undoes it); install.sh calls the same script. Nothing leaves the home.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listHelperApps } from "@/lib/appHelperClient";

export type HelperInstallResult = "installed" | "no_toolchain" | "nobody_logged_in" | "not_mac" | "failed";
export interface HelperInstallOutcome { result: HelperInstallResult; message: string }

export const helperScriptPath = () => process.env.MAIPAI_APP_HELPER_SCRIPT ?? join(import.meta.dir, "..", "..", "..", "scripts", "app-helper.sh");
const isMac = () => (process.env.MAIPAI_TEST_PLATFORM ?? process.platform) === "darwin";

/** True when this hub runs on a Mac that carries the install script, so an Install button can do something. */
export const canInstallHelper = () => isMac() && existsSync(helperScriptPath());

const MESSAGES: Record<HelperInstallResult, string> = {
  installed: "The helper is installed. Close apps is still Off until you turn it on.",
  no_toolchain: "Home needs Apple's Command Line Tools to build the helper. At this Mac's own screen open Terminal, run xcode-select --install, wait for it to finish, then press Install helper again.",
  nobody_logged_in: "Nobody is logged in at this Mac's own screen, and the helper runs in that person's session. Log in there (the lock screen counts as logged out), then press Install helper again.",
  not_mac: "The helper works only when Home runs on a Mac. Close apps stays Off on this computer.",
  failed: "Home could not install the helper. Press Install helper to try again; if it fails again, its log is in the Logs folder in your Library, under MaiPai.",
};
const outcome = (result: HelperInstallResult): HelperInstallOutcome => ({ result, message: MESSAGES[result] });

type Run = (script: string) => Promise<number>;
const runScript: Run = async (script) => {
  const child = Bun.spawn(["bash", script, "install"], { stdout: "ignore", stderr: "ignore", env: process.env });
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  try { return await child.exited; } finally { clearTimeout(timer); }
};

let running: Promise<HelperInstallOutcome> | null = null;

/** Runs the install once at a time. A second press while one is running gets the same answer. Success means the helper answers on its socket, not only that the script exited 0. */
export function installHelper(run: Run = runScript, waitMs = 8000): Promise<HelperInstallOutcome> {
  if (!isMac()) return Promise.resolve(outcome("not_mac"));
  if (!existsSync(helperScriptPath())) return Promise.resolve(outcome("failed"));
  if (running) return running;
  running = (async () => {
    const code = await run(helperScriptPath()).catch(() => 1);
    if (code === 10) return outcome("no_toolchain");
    if (code === 11) return outcome("nobody_logged_in");
    if (code !== 0) return outcome("failed");
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if ((await listHelperApps(undefined, 1000)).installed) return outcome("installed");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return outcome("failed");
  })().finally(() => { running = null; });
  return running;
}
