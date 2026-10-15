// WIZ-STORAGE-05: the operating system's own "choose a folder" window for the
// setup wizard. Setup only runs from this computer (loopback), so the window
// opens on the screen the person is sitting at. Where there is no window to
// open (headless, Docker, Windows for now) it reports "unavailable" and the
// wizard falls back to its in-page picker.
import { spawn } from "node:child_process";

export type NativeFolderResult =
  | { status: "chosen"; path: string }
  | { status: "cancelled" }
  | { status: "unavailable" };

export type Runner = (command: string, args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string } | null>;

const WAIT_MS = 10 * 60_000;

/** Runs a command with no shell; null when the program is not installed. */
export const runCommand: Runner = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill(), WAIT_MS);
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", () => { clearTimeout(timer); resolve(null); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
});

function trimmed(output: string): string {
  const line = output.trim();
  return line.length > 1 ? line.replace(/\/+$/, "") : line;
}

export async function chooseNativeFolder(title: string, run: Runner = runCommand, platform: string = process.platform, env: Record<string, string | undefined> = process.env): Promise<NativeFolderResult> {
  if (platform === "darwin") {
    const out = await run("osascript", ["-e", "on run argv", "-e", "POSIX path of (choose folder with prompt (item 1 of argv))", "-e", "end run", title]);
    if (!out) return { status: "unavailable" };
    if (out.code === 0 && trimmed(out.stdout)) return { status: "chosen", path: trimmed(out.stdout) };
    return out.stderr.includes("-128") ? { status: "cancelled" } : { status: "unavailable" };
  }
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY)) {
    const zenity = await run("zenity", ["--file-selection", "--directory", `--title=${title}`]);
    if (zenity) return zenity.code === 0 && trimmed(zenity.stdout) ? { status: "chosen", path: trimmed(zenity.stdout) } : { status: "cancelled" };
    const kdialog = await run("kdialog", ["--getexistingdirectory", ".", "--title", title]);
    if (kdialog) return kdialog.code === 0 && trimmed(kdialog.stdout) ? { status: "chosen", path: trimmed(kdialog.stdout) } : { status: "cancelled" };
  }
  return { status: "unavailable" };
}
