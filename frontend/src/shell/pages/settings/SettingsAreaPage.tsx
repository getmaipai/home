import { Fragment, useEffect, useMemo, type ReactNode } from "react";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { Empty, EmptyDescription, EmptyHeader } from "@maipai/ui/src/dashboard/components/ui/empty";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { SettingsShell } from "@maipai/ui/src/settings/SettingsShell";
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { searchSettings, type ScopedValues } from "@maipai/ui/src/settings/searchSettings";
import {
  areaAllows,
  resolveTab,
  firstVisibleSection,
  resolveHref,
  visibleGroups,
  visibleTabs,
  type Scope,
  type SettingsAreaDef,
  type SettingsViewer,
} from "@maipai/ui/src/settings/settingsAudience";
import { api, type DeviceInfo, type Roster } from "@/lib/api";
import "@/shell/pages/settings/settingsTokens.css";
import { settingsArea, settingsPath } from "@/shell/pages/settings/settingsAreas";
import { usePackageAreas } from "@/shell/pages/settings/packageAreas";
import { SettingsSectionContent, beforeSettingChange } from "@/shell/pages/settings/SettingsSectionContent";
import { SettingsView } from "@/shell/pages/settings/settingsViews";
import { CodingAdminSettings } from "@/apps/settings/CodingSettings";
import { AssistantKeysSettings } from "@/apps/settings/AssistantKeysSettings";
import { baseViewer, packageAreaKeySet, scopeValueFor, visibleRegistry } from "@/shell/pages/settings/settingsViewer";
import { useSettingsCapabilities } from "@/shell/pages/settings/useSettingsCapabilities";
import { confirmRouteLeave } from "@/shell/routeLeaveGuard";
import { useAppRows } from "@/shell/useAppCatalog";
import { backLabelFor, lastAppRoute } from "@/shell/pages/settings/settingsBackLink";
import { getIcon } from "@maipai/ui/src/icons";
import { useSetupChecklist, setupChecklistCountLine } from "@/shell/useSetupChecklist";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";

/** The kit's `lg` breakpoint: from here the column and the content sit side
 * by side; below it the shell drills in (the column alone, then a section). */
const DESKTOP_MIN_WIDTH = 960;

/** `/settings/:area/:section?`: one settings area in the kit's one settings
 * shell (RULES S4). This page holds data only: the area from the spec, who is
 * looking, the registry, and which section is open; the shell and the
 * renderer draw everything. An area the viewer may not open replaces to
 * their own Settings page before any household request is made. */
export function SettingsAreaPage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  useHeaderExtra(PageHeaderTitle);
  const { section: areaId } = useParams();
  const { areas: packageAreas, ready } = usePackageAreas();
  const central = settingsArea("settings");
  const packageArea = packageAreas.find((candidate) => candidate.id === areaId);
  const homeArea = settingsArea(areaId);
  const area = !areaId || central?.sections.some((section) => section.id === areaId)
    ? central
    : homeArea ?? packageArea;
  // A package's area is known only once the app list has answered: wait for it, never bounce to Account first.
  if (!area && !ready) return <Progress mode="spinner" label="Loading settings" />;
  if (!area) return <Navigate to={settingsPath("profile")} replace />;
  const routeViewer = { ...baseViewer(person), role: person.role === "owner" ? "admin" as const : person.role as SettingsViewer["role"] };
  if (!areaAllows(area, routeViewer)) {
    if (area.id === "settings" && area.sections.find((section) => section.id === areaId)?.scope === "household") return (
      <>
        <Empty>
          <EmptyHeader>
            <EmptyDescription>Only a parent or admin can change these settings. Ask the person who set up Home.</EmptyDescription>
          </EmptyHeader>
          <Button variant="link" render={<Link to={settingsPath("profile")} />}>Open your settings</Button>
        </Empty>
      </>
    );
    return <Navigate to={settingsPath("profile")} replace />;
  }
  const requestedSection = area.id === "settings" ? area.sections.find((section) => section.id === areaId) : undefined;
  if (requestedSection?.scope === "household" && person.role !== "owner" && person.role !== "admin") return (
    <>
      <Empty>
        <EmptyHeader><EmptyDescription>Only a parent or admin can change these settings. Ask the person who set up Home.</EmptyDescription></EmptyHeader>
        <Button variant="link" render={<Link to={settingsPath("profile")} />}>Open your settings</Button>
      </Empty>
    </>
  );
  return <SettingsAreaBody key={area.id} area={area} packageAreas={packageAreas} person={person} onPersonChange={onPersonChange} packageArea={area.id !== "settings" && area.id !== "clock"} />;
}

const BackIcon = getIcon("arrow-left");

/** COLUMN-UNIFY-01 (owner, 2026-10-19: a settings page had no way back to the app): the settings column's first row returns to the
 * app the person came from, with the column's title under it. The kit draws no title of its own once it is given a back link. */
function SettingsBackLink({ title, reach }: { title: string; reach: string }) {
  const rows = useAppRows();
  const to = lastAppRoute();
  const label = backLabelFor(to, Object.fromEntries((rows ?? []).map((row) => [row.package, row.label])));
  return (
    <>
      <div className="flex"><Button variant="ghost" size="row" render={<Link to={to} aria-label={label === "Back" ? label : `Back to ${label}`} onClick={(event) => { if (!confirmRouteLeave()) event.preventDefault(); }} />}>
        <BackIcon aria-hidden />
        {label}
      </Button></div>
      <h2 className="px-2 text-lg leading-7 font-semibold">{title}</h2>
      <Badge variant="secondary">{reach}</Badge>
    </>
  );
}

function scopesOf(area: SettingsAreaDef, viewer: SettingsViewer): Scope[] {
  const scopes = new Set<Scope>();
  for (const section of area.sections) for (const card of section.cards ?? []) if (card.scope) scopes.add(card.scope);
  // An adult may only load the household scope from an admin-visible page.
  if (viewer.role !== "owner" && viewer.role !== "admin") scopes.delete("household");
  return [...scopes];
}

function SettingsAreaBody({ area, packageAreas, person, onPersonChange, packageArea }: { area: SettingsAreaDef; packageAreas: readonly SettingsAreaDef[]; person: Roster; onPersonChange: () => void | Promise<void>; packageArea: boolean }) {
  const routeParams = useParams();
  const sectionId = packageArea ? routeParams.detailId : routeParams.section;
  const detailId = packageArea ? undefined : routeParams.detailId;
  const pagePath = (id?: string, pageTab?: string) => packageArea && area.id !== "clock"
    ? `/settings/${area.id}${id ? `/${id}` : ""}`
    : settingsPath(id, pageTab);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const setupChecklist = useSetupChecklist(person);
  const desktop = useBreakpoint().atLeast(DESKTOP_MIN_WIDTH);
  const query = params.get("q") ?? "";
  const registryQuery = useQuery<SettingsKey[]>({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const robotQuery = useQuery<DeviceInfo[]>({ queryKey: ["robot-devices"], queryFn: () => api.robotDevices(), enabled: area.id === "settings" && sectionId === "apps" && Boolean(detailId) });
  const { capabilities, ready } = useSettingsCapabilities(person, true);
  const viewer: SettingsViewer = useMemo(() => ({ ...baseViewer(person), capabilities }), [person, capabilities]);
  const packageKeys = registryQuery.data ? packageAreaKeySet(packageAreas, registryQuery.data) : undefined;
  const registry = registryQuery.data
    ? visibleRegistry(registryQuery.data, viewer.band, area.id === "settings" && sectionId === "advanced" ? ["network.hub_port"] : [], packageKeys)
    : undefined;

  const scopes = scopesOf(area, viewer);
  const valueQueries = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: ["settings-values", scopeValueFor(scope, person.id)],
      queryFn: () => api.settingsValues(scopeValueFor(scope, person.id)),
      enabled: query.trim().length > 0,
    })),
  });

  const policyViewer: SettingsViewer = useMemo(() => ({ ...viewer, role: person.role === "owner" ? "admin" : viewer.role, capabilities: ready ? capabilities : [] }), [viewer, person.role, ready, capabilities]);
  const groups = registry ? visibleGroups(area, policyViewer, registry, "home") : [];
  const active = groups.flatMap((group) => group.sections).find((section) => section.id === sectionId);
  const sectionDefinition = area.sections.find((section) => section.id === sectionId);
  const tabs = useMemo(() => active ? (detailId && active.detail ? active.detail.tabs ?? [] : visibleTabs(active, policyViewer)) : [], [active, detailId, policyViewer]);
  const tab = resolveTab(tabs, params.get("tab") ?? undefined);
  const currentTab = params.get("tab") ?? tab;
  const first = registry ? firstVisibleSection(area, policyViewer, registry, "home") : undefined;

  useEffect(() => {
    if (!ready || !active || !params.has("tab") || !tab || params.get("tab") === tab) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === tabs[0]?.id) next.delete("tab");
      else next.set("tab", tab);
      return next;
    }, { replace: true });
  }, [active, params, ready, setParams, tab, tabs]);

  useEffect(() => {
    if (!query) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setParams((current) => { const next = new URLSearchParams(current); next.delete("q"); return next; }, { replace: true }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, setParams]);

  if (!registry || !ready) return <Progress mode="spinner" label="Loading settings" />;

  // No section named: a desktop opens the first one; a phone shows the column.
  if (!sectionId && desktop && first) return <Navigate to={pagePath(first.id)} replace />;
  // A section that is hidden, unknown or has no content here: the response never says it exists.
  if (sectionId && !active && !(sectionDefinition && sectionDefinition.needs && !ready)) {
    if (area.id === "settings" && !first) return null;
    return <Navigate to={desktop && first ? pagePath(first.id) : settingsPath("profile")} replace />;
  }
  if (detailId && !active?.detail) return <Navigate to={settingsPath(active?.id)} replace />;
  if (active?.detail && params.has("device") && !detailId) {
    const next = new URLSearchParams(params);
    const legacyId = next.get("device");
    next.delete("device");
    const detailTab = next.get("tab") ?? "overview";
    next.delete("tab");
    const detailPath = settingsPath(active.id, detailTab, undefined, legacyId ?? undefined);
    return <Navigate to={`${detailPath}${next.size ? `&${next}` : ""}${location.hash}`} replace />;
  }
  // An arrow row asked for directly (`/settings/chat/voice`) goes where it points.
  if (active?.kind === "link") return <Navigate to={resolveHref(active.href ?? settingsPath("profile"), viewer)} replace />;
  if (!sectionId && !desktop && !first && area.id !== "settings") return <Navigate to={settingsPath("profile")} replace />;

  const focusKey = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : undefined;
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
    content = detailId && active.detail
      ? <SettingsView view={active.detail.view} person={person} onPersonChange={onPersonChange} tab={tab} detailId={detailId} />
      : active.kind === "view"
      ? <>{(active.tabs?.find((item) => item.id === currentTab)?.view ?? active.view) ? <SettingsView view={(active.tabs?.find((item) => item.id === currentTab)?.view ?? active.view)!} person={person} onPersonChange={onPersonChange} tab={currentTab} /> : null}</>
      : area.id === "settings" && active.id === "ai" && tab === "coding"
        ? <CodingAdminSettings />
        : area.id === "settings" && active.id === "ai"
          ? <><SettingsSectionContent section={active} viewer={policyViewer} registry={registry} packageKeys={packageKeys} person={person} onPersonChange={onPersonChange} focusKey={focusKey} tab={currentTab} />{(viewer.role === "owner" || viewer.role === "admin") && currentTab !== "performance" ? <AssistantKeysSettings /> : null}</>
          : <SettingsSectionContent section={active} viewer={policyViewer} registry={registry} packageKeys={packageKeys} person={person} onPersonChange={onPersonChange} focusKey={focusKey} tab={currentTab} />;
  }

  const detailName = area.id === "settings" && active?.id === "apps" && detailId
    ? robotQuery.data?.find((device) => device.id === detailId)?.name ?? active.label
    : undefined;

  const checklistItems = setupChecklist.checklist.data ?? [];
  const checklistOpenCount = checklistItems.filter((item) => !item.done).length;
  if (area.id === "settings" && active?.id === "household" && tab === "general" && checklistOpenCount > 0) {
    content = <>
      <Card>
        <CardHeader>
          <CardTitle>Finish setting up</CardTitle>
          <CardDescription>{setupChecklistCountLine(checklistOpenCount)}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup variant="card" aria-label="Finish setting up">
            {checklistItems.map((item, index) => <Fragment key={item.id}>
              {index > 0 ? <ItemSeparator variant="inset" /> : null}
              <Item>
                <ItemContent>
                  <ItemTitle>{item.title}</ItemTitle>
                  <ItemDescription clamp={false}>{item.reason}</ItemDescription>
                </ItemContent>
                <ItemFooter>
                  {item.done ? <Badge variant="secondary">Done</Badge> : <>
                    <Button aria-label={`Open ${item.title}`} variant="outline" size="row" render={<Link to={item.open.href} state={item.id === "away-access" ? { from: `${location.pathname}${location.search}${location.hash}` } : undefined} />}>{item.open.label}</Button>
                    <Button variant="ghost" size="row" disabled={setupChecklist.dismiss.isPending} onClick={() => setupChecklist.dismiss.mutate(item.id)}>Not now</Button>
                  </>}
                </ItemFooter>
              </Item>
            </Fragment>)}
          </ItemGroup>
          {setupChecklist.dismiss.isError ? <p role="alert" className="text-sm text-destructive">Could not hide this item. Try again.</p> : null}
        </CardContent>
      </Card>
      {content}
    </>;
  }

  return (
    <SettingsShell
      layout="docked"
      backLink={<SettingsBackLink title="Settings" reach={active?.scope === "household" ? "Applies to everyone at home" : "Only you"} />}
      labels={{ columnTitle: "Settings" }}
      trail={[{ label: area.title, href: packageArea && area.id !== "clock" ? `/settings/${area.id}` : settingsPath() }, ...(active ? [{ label: active.label, href: detailId ? pagePath(active.id, tab) : undefined }] : []), ...(detailId ? [{ label: detailName ?? active?.label ?? detailId }] : [])]}
      contentAs="section"
      area={area}
      viewer={viewer}
      registry={registry}
      honouredBy="home"
      activeSection={active?.id}
      tabs={tabs}
      tab={tab}
      onTabChange={(id) => { if (confirmRouteLeave()) setParams((current) => { const next = new URLSearchParams(current); if (id === tabs[0]?.id) next.delete("tab"); else next.set("tab", id); return next; }); }}
      sectionHref={(id) => packageArea && area.id !== "clock" ? `/settings/${area.id}/${id}` : settingsPath(id)}
      onNavigate={(to) => { if (confirmRouteLeave()) navigate(to.kind === "link" ? to.href : pagePath(to.sectionId)); }}
      searchQuery={query}
      onSearchChange={(next) => setParams((current) => { const updated = new URLSearchParams(current); if (next) updated.set("q", next); else updated.delete("q"); return updated; }, { replace: true })}
      onBack={() => { if (confirmRouteLeave()) navigate(packageArea ? `/settings/${area.id}` : settingsPath(detailId ? active?.id : undefined)); }}
    >
      {content}
    </SettingsShell>
  );
}
