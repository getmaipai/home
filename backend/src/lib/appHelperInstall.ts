// MEM-SPACE-08: installs the Mac app helper from the Close apps card and the setup wizard. The one definition of how is scripts/app-helper.sh
// (user-level LaunchAgent, built on this Mac, no privileges, `remove` undoes it); install.sh calls the same script. Nothing leaves the home.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { consoleUserHome, helperSocketPath, listHelperApps } from "@/lib/appHelperClient";
import { homedir, tmpdir } from "node:os";

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
/** Where the install output goes: the Logs folder the failure message names, in the home of the person at the Mac (root's folder when the hub runs as root and nobody is logged in). */
export const installLogPath = () => process.env.NODE_ENV === "test" ? join(tmpdir(), "maipai-test-app-helper-install.log") : join((process.getuid?.() === 0 ? consoleUserHome() : null) ?? homedir(), "Library", "Logs", "MaiPai", "app-helper-install.log");
const runScript: Run = async (script) => {
  const log = installLogPath();
  try { mkdirSync(join(log, ".."), { recursive: true }); } catch { /* the log is a help, never a blocker */ }
  const note = (text: string) => { try { appendFileSync(log, text, { mode: 0o644 }); } catch { /* same */ } };
  const child = Bun.spawn(["bash", script, "install"], { stdout: "pipe", stderr: "pipe", env: process.env });
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    note(`--- install ${new Date().toISOString()} exit ${code}\n${out}${err}\n`);
    return code;
  } finally { clearTimeout(timer); }
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
    try { appendFileSync(installLogPath(), `--- the install script exited 0 but nothing answered on ${helperSocketPath()} (uid ${process.getuid?.()}, socket file ${existsSync(helperSocketPath()) ? "exists" : "missing"})\n`); } catch { /* log only */ }
    return outcome("failed");
  })().finally(() => { running = null; });
  return running;
}
