import { useEffect, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { Empty, EmptyDescription, EmptyHeader } from "@maipai/ui/src/dashboard/components/ui/empty";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { SettingsShell } from "@maipai/ui/src/settings/SettingsShell";
import { SidebarMenuButton } from "@maipai/ui/src/dashboard/components/ui/sidebar";
import { getIcon } from "@maipai/ui/src/icons";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { searchSettings, type ScopedValues } from "@maipai/ui/src/settings/searchSettings";
import {
  areaAllows,
  firstVisibleSection,
  resolveHref,
  visibleGroups,
  type Scope,
  type SettingsAreaDef,
  type SettingsViewer,
} from "@maipai/ui/src/settings/settingsAudience";
import { api, type Roster } from "@/lib/api";
import "@/next/pages/settings/settingsTokens.css";
import { useTabItem } from "@/shell/tabIdentity";
import { settingsArea, settingsPath } from "@/next/pages/settings/settingsAreas";
import { SettingsSectionContent, beforeSettingChange } from "@/next/pages/settings/SettingsSectionContent";
import { SETTINGS_VIEWS } from "@/next/pages/settings/settingsViews";
import { baseViewer, scopeValueFor, visibleRegistry } from "@/next/pages/settings/settingsViewer";
import { useSettingsCapabilities } from "@/next/pages/settings/useSettingsCapabilities";
import { useChatColumn } from "@/next/pages/ChatColumn";
import { registerSidebarToggleShortcut } from "@/next/pages/chatShortcuts";
import { lastAppRoute } from "@/next/pages/settings/settingsBackLink";

/** The kit's `lg` breakpoint: from here the column and the content sit side
 * by side; below it the shell drills in (the column alone, then a section). */
const DESKTOP_MIN_WIDTH = 960;
const BackArrow = getIcon("chevron-left");

/** `/settings/:area/:section?`: one settings area in the kit's one settings
 * shell (RULES S4). This page holds data only: the area from the spec, who is
 * looking, the registry, and which section is open; the shell and the
 * renderer draw everything. An area the viewer may not open replaces to
 * Account before any request is made, so an adult asking for Home settings
 * costs no household request. */
export function SettingsAreaPage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  const { area: areaId } = useParams();
  const area = settingsArea(areaId);
  if (!area || !areaAllows(area, baseViewer(person))) return <Navigate to={settingsPath("account")} replace />;
  return <SettingsAreaBody key={area.id} area={area} person={person} onPersonChange={onPersonChange} />;
}

function scopesOf(area: SettingsAreaDef, viewer: SettingsViewer): Scope[] {
  const scopes = new Set<Scope>();
  for (const section of area.sections) for (const card of section.cards ?? []) if (card.scope) scopes.add(card.scope);
  // The household scope is Home settings' alone, and Home settings is admins'.
  if (viewer.role !== "owner" && viewer.role !== "admin") scopes.delete("household");
  return [...scopes];
}

function SettingsAreaBody({ area, person, onPersonChange }: { area: SettingsAreaDef; person: Roster; onPersonChange: () => void | Promise<void> }) {
  const { section: sectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const desktop = useBreakpoint().atLeast(DESKTOP_MIN_WIDTH);
  const column = useChatColumn({ isDesktop: desktop });
  const query = params.get("q") ?? "";
  useTabItem(area.title);
  useEffect(() => desktop ? registerSidebarToggleShortcut(column.control.toggle) : undefined, [desktop, column.control]);

  const registryQuery = useQuery<SettingsKey[]>({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const { capabilities, ready } = useSettingsCapabilities(person);
  const viewer: SettingsViewer = { ...baseViewer(person), capabilities };
  const registry = registryQuery.data ? visibleRegistry(registryQuery.data, viewer.band) : undefined;

  const scopes = scopesOf(area, viewer);
  const valueQueries = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: ["settings-values", scopeValueFor(scope, person.id)],
      queryFn: () => api.settingsValues(scopeValueFor(scope, person.id)),
      enabled: query.trim().length > 0,
    })),
  });

  const groups = registry ? visibleGroups(area, viewer, registry, "home") : [];
  const active = groups.flatMap((group) => group.sections).find((section) => section.id === sectionId);
  const first = registry ? firstVisibleSection(area, viewer, registry, "home") : undefined;

  useEffect(() => {
    if (!query) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setParams((current) => { const next = new URLSearchParams(current); next.delete("q"); return next; }, { replace: true }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, setParams]);

  if (!registry || !ready) return <Progress mode="spinner" label="Loading settings" />;

  // No section named: a desktop opens the first one; a phone shows the column.
  if (!sectionId && desktop && first) return <Navigate to={settingsPath(area.id, first.id)} replace />;
  // A section that is hidden, unknown or has no content here: the response never says it exists.
  if (sectionId && !active) {
    if (area.id === "account" && !first) return null;
    return <Navigate to={desktop && first ? settingsPath(area.id, first.id) : area.id === "account" ? settingsPath("account") : settingsPath(area.id)} replace />;
  }
  // An arrow row asked for directly (`/settings/chat/voice`) goes where it points.
  if (active?.kind === "link") return <Navigate to={resolveHref(active.href ?? settingsPath(area.id), viewer)} replace />;
  if (!sectionId && !desktop && !first && area.id !== "account") return <Navigate to={settingsPath("account")} replace />;

  const focusKey = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : undefined;
  const backToApp = lastAppRoute();
  const backLink = (
    <SidebarMenuButton size="settings" render={<Link to={backToApp} />} data-slot="settings-back-to-app">
      <BackArrow aria-hidden className="size-4" />
      <span>Back to app</span>
    </SidebarMenuButton>
  );
  const values: ScopedValues = {};
  scopes.forEach((scope, index) => { const data = valueQueries[index]?.data; if (data) values[scope] = data; });

  let content: ReactNode = null;
  if (query.trim()) {
    const results = searchSettings(area, registry, values, viewer, query, { honouredBy: "home" });
    const byCrumb = new Map<string, typeof results>();
    for (const result of results) byCrumb.set(result.breadcrumb, [...(byCrumb.get(result.breadcrumb) ?? []), result]);
    content = results.length === 0
      ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>No settings match that search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
      : (
        <div className="flex min-w-0 flex-col gap-14">
          {[...byCrumb.entries()].map(([crumb, rows]) => {
            const def = rows[0]!.setting.def;
            return (
              <SettingsRenderer
                key={`${crumb}:${def.scope}:${def.lives_in}`}
                scope={def.scope}
                scopeValue={scopeValueFor(def.scope, person.id)}
                honouredBy="home"
                only={[def.lives_in]}
                includeKeys={rows.map((row) => row.setting.def.key)}
                titleOverrides={{ [def.lives_in]: crumb }}
                beforeChange={beforeSettingChange}
              />
            );
          })}
        </div>
      );
  } else if (active) {
    content = active.kind === "view"
      ? <>{active.view ? SETTINGS_VIEWS[active.view]?.({ person, onPersonChange }) : null}</>
      : <SettingsSectionContent section={active} viewer={viewer} registry={registry} person={person} onPersonChange={onPersonChange} focusKey={focusKey} />;
  }

  return (
    <SettingsShell
      layout="docked"
      backLink={backLink}
      collapsible={desktop ? {
        collapsed: column.collapsed,
        peek: column.peek,
        onToggle: column.toggleFromButton,
        columnToggleRef: column.columnToggleRef,
        headerToggleRef: column.headerToggleRef,
        onPeekEnter: column.peekZoneHandlers.onPointerEnter,
        onPeekLeave: column.peekZoneHandlers.onPointerLeave,
        onPeekColumnEnter: column.peekColumnHandlers.onPointerEnter,
        onPeekColumnLeave: column.peekColumnHandlers.onPointerLeave,
      } : undefined}
      contentAs="section"
      area={area}
      viewer={viewer}
      registry={registry}
      honouredBy="home"
      activeSection={active?.id}
      sectionHref={(id) => settingsPath(area.id, id)}
      onNavigate={(to) => navigate(to.kind === "link" ? to.href : settingsPath(area.id, to.sectionId))}
      searchQuery={query}
      onSearchChange={(next) => setParams((current) => { const updated = new URLSearchParams(current); if (next) updated.set("q", next); else updated.delete("q"); return updated; }, { replace: true })}
      onBack={() => navigate(settingsPath(area.id))}
    >
      {content}
    </SettingsShell>
  );
}
