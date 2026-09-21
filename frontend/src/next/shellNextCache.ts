const KEY = "maipai.shell.next";

export type ShellNextCacheValue = { on: boolean; look: string; dark: boolean } | null;

export function readShellNextCache(): ShellNextCacheValue {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.on === "boolean" &&
      typeof parsed.look === "string" &&
      typeof parsed.dark === "boolean"
    ) {
      return { on: parsed.on, look: parsed.look, dark: parsed.dark };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeShellNextCache(v: { on: boolean; look: string; dark: boolean }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage blocked (private window, etc.) - silently skip.
  }
}
