// The Library column's open or hidden state is a per-person, per-browser preference (the same class as the Chat column's),
// never a household setting: it does not reach the server.
const key = (personId: string) => `maipai.library.sidebar-collapsed.${personId}`;

export function readLibrarySidebarCollapsed(personId: string): boolean {
  try { return localStorage.getItem(key(personId)) === "1"; } catch { return false; }
}
export function writeLibrarySidebarCollapsed(personId: string, collapsed: boolean): void {
  try { localStorage.setItem(key(personId), collapsed ? "1" : "0"); } catch { /* storage blocked: the choice just does not persist */ }
}
