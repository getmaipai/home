import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useState, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SectionSidebarGroup, SectionSidebarItem, SectionSidebarProps } from "@maipai/ui/src/primitives/SectionSidebar";
import { api, type AppRow } from "@/lib/api";

type Row = Record<string, unknown>;
type Sidebar = NonNullable<AppRow["sidebar"]>;
type Rows = NonNullable<Sidebar["groups"][number]["rows"]>;

/** NEWS-SIDEBAR-01: the data for the kit's one section sidebar from a package app's declared column (`contributes.sidebar`, already
 * reduced by the hub to what this person may open). It fetches each group's rows through the package's own data route, fills an
 * entry's `navigate` from its row, and returns props only: the page renders the kit part with them (from wide screens up; a phone
 * gets the same entries in the shell's drawer). Home holds no per-app code. Null when the app declares no column. */
export function useAppSidebar(app: Pick<AppRow, "package" | "to" | "label"> | undefined, sidebar: Sidebar | undefined, current: string, pageState: Record<string, unknown>): Pick<SectionSidebarProps, "groups" | "search"> | null {
  const navigate = useNavigate();
  const location = useLocation();
  const rowGroups = (sidebar?.groups ?? []).filter((group) => group.rows);
  const results = useQueries({
    queries: rowGroups.map((group) => ({
      // A new location refetches, so a follow made on a page shows in the column on the next move.
      queryKey: ["app-sidebar", app?.package, String((group.rows as Rows).bind.path), location.key],
      queryFn: () => api.appData<Row[] | { rows?: Row[] }>(app!.package, String((group.rows as Rows).bind.path)),
      enabled: app !== undefined,
      placeholderData: keepPreviousData,
      retry: false,
    })),
  });
  const rowsOf = (index: number): Row[] => {
    const data = results[index]?.data;
    return Array.isArray(data) ? data : (data?.rows ?? []);
  };

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const search = sidebar?.search as { state?: string; label?: string; placeholder?: string; recents?: { path?: string }; submit?: unknown } | undefined;
  const recentsPath = search?.recents?.path;
  const recents = useQuery({
    queryKey: ["app-sidebar-recents", app?.package, recentsPath],
    queryFn: () => api.appData<Row[] | { rows?: Row[] }>(app!.package, String(recentsPath)),
    enabled: app !== undefined && focused && recentsPath !== undefined,
    retry: false,
  });
  const recentRows: Row[] = Array.isArray(recents.data) ? recents.data : (recents.data?.rows ?? []);

  function go(action: unknown, fields: Record<string, unknown>): void {
    const target = navigateOf(action);
    if (!target) return;
    navigate(fill(target.to, fields), { state: { pageState: fillState(target.state, fields) } });
  }
  const plain = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  const hrefOf = (to: string): string => to;

  if (!app || !sidebar) return null;
  const groups: SectionSidebarGroup[] = [];
  let rowIndex = -1;
  for (const group of sidebar.groups) {
    if (group.pages) {
      groups.push({
        id: group.id,
        ...(group.title ? { label: group.title } : {}),
        items: group.pages.map((page): SectionSidebarItem => {
          const to = page.page === "index" ? app.to : `${app.to}/${page.page}`;
          return { id: page.page, label: page.label, icon: page.icon ?? undefined, href: hrefOf(to), active: current === page.page && Object.keys(pageState).length === 0, onClick: (event) => { if (plain(event)) { event.preventDefault(); navigate(to); } } };
        }),
      });
      continue;
    }
    rowIndex += 1;
    const rows = group.rows as Rows;
    const keyField = rows.item_key_field ?? "key";
    const labelField = rows.item_label_field ?? "label";
    const items: SectionSidebarItem[] = rowsOf(rowIndex)
      .filter((row) => !rows.only_followed || row.followed === true)
      .map((row): SectionSidebarItem => {
        const target = navigateOf(rows.open);
        const to = target ? fill(target.to, row) : app.to;
        const state = target ? fillState(target.state, row) : {};
        const media = rows.item_media_field ? String(row[rows.item_media_field] ?? "") : "";
        return {
          id: String(row[keyField] ?? row[labelField]),
          label: String(row[labelField] ?? ""),
          ...(media.startsWith("/") ? { media } : media ? { icon: media } : {}),
          href: hrefOf(to),
          active: location.pathname === to && Object.entries(state).every(([name, value]) => String(pageState[name] ?? "") === value),
          onClick: (event) => { if (plain(event)) { event.preventDefault(); go(rows.open, row); } },
        };
      });
    if (rows.manage) {
      const manage = rows.manage;
      const target = navigateOf(manage.open);
      items.push({ id: `${group.id}-manage`, label: manage.label, icon: "settings-2", href: hrefOf(target?.to ?? app.to), onClick: (event) => { if (plain(event)) { event.preventDefault(); go(manage.open, {}); } } });
    }
    if (items.length > 0) groups.push({ id: group.id, ...(group.title ? { label: group.title } : {}), items });
  }

  const label = search?.label ?? search?.placeholder ?? "Search";
  // The search results page draws its own box (it keeps recents), so the column's box gives way to it there.
  const searchPage = navigateOf(search?.submit)?.to.split("/").filter(Boolean)[2] ?? "index";
  const onSearchPage = current === searchPage;
  return {
    groups,
    search: search && !onSearchPage ? {
      value: query,
      onChange: setQuery,
      label,
      onFocus: () => setFocused(true),
      onBlur: () => window.setTimeout(() => setFocused(false), 150),
      onSubmit: () => { if (query.trim()) { go(search.submit, { q: query.trim() }); setFocused(false); } },
      ...(focused && query === "" && recentRows.length > 0 ? { recents: recentRows.map((row) => ({ key: String(row.key ?? row.label), label: String(row.label ?? "") })), onRecent: (recent: string) => { setQuery(recent); go(search.submit, { q: recent }); } } : {}),
    } : undefined,
  };
}

/** `{field}` placeholders in a string fill from the row, as an action's own state does on a list. */
function fill(template: string, fields: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(fields[name] ?? ""));
}

function navigateOf(action: unknown): { to: string; state: Record<string, unknown> } | null {
  const navigate = typeof action === "object" && action !== null ? (action as { navigate?: { to?: unknown; state?: unknown } }).navigate : undefined;
  if (!navigate || typeof navigate.to !== "string") return null;
  return { to: navigate.to, state: typeof navigate.state === "object" && navigate.state !== null ? (navigate.state as Record<string, unknown>) : {} };
}

function fillState(state: Record<string, unknown>, fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(state).map(([name, value]) => [name, typeof value === "string" ? fill(value, fields) : String(value)]));
}
