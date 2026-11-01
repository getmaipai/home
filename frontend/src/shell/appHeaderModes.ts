import type { AppRow } from "@/lib/api";

type Header = NonNullable<AppRow["header"]>;
type Sidebar = NonNullable<AppRow["sidebar"]>;

/** MEDIA-HEADER-01: which header mode the person is in. The address decides: a page that sits in one mode's sidebar group, or is a
 * mode's own landing page, belongs to that mode. A page in no mode (a search results page, a detail page) keeps the mode the person
 * last chose in this app on this browser, and the first mode is the default. */
export function resolveMode(header: Header | undefined, sidebar: Sidebar | undefined, pageId: string, remembered: string | null): string | undefined {
  const modes = header?.modes ?? [];
  if (modes.length === 0) return undefined;
  const ids = new Set(modes.map((mode) => mode.id));
  const byGroup = sidebar?.groups.find((group) => group.mode !== undefined && ids.has(group.mode) && group.pages?.some((page) => page.page === pageId));
  if (byGroup?.mode) return byGroup.mode;
  const byLanding = modes.find((mode) => mode.page === pageId);
  if (byLanding) return byLanding.id;
  return remembered !== null && ids.has(remembered) ? remembered : modes[0]!.id;
}

/** The sidebar as one mode draws it: groups with no mode are in every mode. */
export function sidebarInMode(sidebar: Sidebar | undefined, mode: string | undefined): Sidebar | undefined {
  if (!sidebar || mode === undefined) return sidebar;
  return { ...sidebar, groups: sidebar.groups.filter((group) => group.mode === undefined || group.mode === mode) };
}

const key = (owner: string, packageId: string): string => `maipai.mode.v1:${owner}:${packageId}`;
export function rememberedMode(owner: string, packageId: string): string | null {
  if (!owner) return null;
  try { return localStorage.getItem(key(owner, packageId)); } catch { return null; }
}
export function rememberMode(owner: string, packageId: string, mode: string): void {
  if (!owner) return;
  try { localStorage.setItem(key(owner, packageId), mode); } catch { /* a blocked store only means the next visit opens the default mode */ }
}
