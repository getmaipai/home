// CHAT-FIND-0923-01: the thread rail's own collapsed/open state is a
// per-browser preference (the same class as a remembered tab), never a
// household setting - it never reached the server before and doesn't
// here either. Mirrors micDevicePreference.ts's own shape exactly (a
// plain read/write function pair, not a hook; try/catch around both,
// since localStorage can throw in a private window), the same
// per-browser-preference precedent shellNextCache.ts and
// micDevicePreference.ts already established, not a second pattern
// invented for this.
const KEY = "maipai.chat.rail-collapsed";

export function readRailCollapsePreference(): boolean | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeRailCollapsePreference(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked (private window, etc.) - silently skip.
  }
}
