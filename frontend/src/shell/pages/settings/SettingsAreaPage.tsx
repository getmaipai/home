import { Fragment, useEffect, type ReactNode } from "react";
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
  firstVisibleSection,
  resolveHref,
  visibleGroups,
  type Scope,
  type SettingsAreaDef,
  type SettingsViewer,
} from "@maipai/ui/src/settings/settingsAudience";
import { api, type Roster } from "@/lib/api";
import "@/shell/pages/settings/settingsTokens.css";
import { useTabItem } from "@/shell/tabIdentity";
import { settingsArea, settingsPath } from "@/shell/pages/settings/settingsAreas";
import { usePackageAreas } from "@/shell/pages/settings/packageAreas";
import { SettingsSectionContent, beforeSettingChange } from "@/shell/pages/settings/SettingsSectionContent";
import { SettingsView } from "@/shell/pages/settings/settingsViews";
import { CodingAdminSettings } from "@/apps/settings/CodingSettings";
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
 * Account before any request is made, so an adult asking for Home settings
 * costs no household request. */
export function SettingsAreaPage({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  const { area: areaId } = useParams();
  const { areas: packageAreas, ready } = usePackageAreas();
  const area = settingsArea(areaId) ?? packageAreas.find((candidate) => candidate.id === areaId);
  // A package's area is known only once the app list has answered: wait for it, never bounce to Account first.
  if (!area && !ready) return <Progress mode="spinner" label="Loading settings" />;
  if (!area || !areaAllows(area, baseViewer(person))) return <Navigate to={settingsPath("account")} replace />;
  return <SettingsAreaBody key={area.id} area={area} packageAreas={packageAreas} person={person} onPersonChange={onPersonChange} />;
}

const BackIcon = getIcon("arrow-left");

/** COLUMN-UNIFY-01 (owner, 2026-10-19: a settings page had no way back to the app): the settings column's first row returns to the
 * app the person came from, with the column's title under it. The kit draws no title of its own once it is given a back link. */
function SettingsBackLink() {
  const rows = useAppRows();
  const to = lastAppRoute();
  const label = backLabelFor(to, Object.fromEntries((rows ?? []).map((row) => [row.package, row.label])));
  return (
    <>
      <div className="flex"><Button variant="ghost" size="row" render={<Link to={to} aria-label={label === "Back" ? label : `Back to ${label}`} onClick={(event) => { if (!confirmRouteLeave()) event.preventDefault(); }} />}>
        <BackIcon aria-hidden />
        {label}
      </Button></div>
      <h2 className="px-2 text-lg leading-7 font-semibold">Settings</h2>
    </>
  );
}

function scopesOf(area: SettingsAreaDef, viewer: SettingsViewer): Scope[] {
  const scopes = new Set<Scope>();
  for (const section of area.sections) for (const card of section.cards ?? []) if (card.scope) scopes.add(card.scope);
  // The household scope is Home settings' alone, and Home settings is admins'.
  if (viewer.role !== "owner" && viewer.role !== "admin") scopes.delete("household");
  return [...scopes];
}

function SettingsAreaBody({ area, packageAreas, person, onPersonChange }: { area: SettingsAreaDef; packageAreas: readonly SettingsAreaDef[]; person: Roster; onPersonChange: () => void | Promise<void> }) {
  const { section: sectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const setupChecklist = useSetupChecklist(person);
  const desktop = useBreakpoint().atLeast(DESKTOP_MIN_WIDTH);
  const query = params.get("q") ?? "";
  useTabItem(area.title);

  const registryQuery = useQuery<SettingsKey[]>({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), staleTime: Infinity });
  const { capabilities, ready } = useSettingsCapabilities(person, area.id === "account");
  const viewer: SettingsViewer = { ...baseViewer(person), capabilities };
  const packageKeys = registryQuery.data ? packageAreaKeySet(packageAreas, registryQuery.data) : undefined;
  const registry = registryQuery.data
    ? visibleRegistry(registryQuery.data, viewer.band, area.id === "home" && sectionId === "network" ? ["network.hub_port"] : [], packageKeys)
    : undefined;

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
      ? <>{active.view ? <SettingsView view={active.view} person={person} onPersonChange={onPersonChange} /> : null}</>
      : area.id === "home" && active.id === "coding"
        ? <CodingAdminSettings />
        : <SettingsSectionContent section={active} viewer={viewer} registry={registry} packageKeys={packageKeys} person={person} onPersonChange={onPersonChange} focusKey={focusKey} />;
  }

  const checklistItems = setupChecklist.checklist.data ?? [];
  const checklistOpenCount = checklistItems.filter((item) => !item.done).length;
  if (area.id === "home" && active?.id === "general" && checklistOpenCount > 0) {
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
      backLink={<SettingsBackLink />}
      labels={{ columnTitle: "Settings" }}
      contentAs="section"
      area={area}
      viewer={viewer}
      registry={registry}
      honouredBy="home"
      activeSection={active?.id}
      sectionHref={(id) => settingsPath(area.id, id)}
      onNavigate={(to) => { if (confirmRouteLeave()) navigate(to.kind === "link" ? to.href : settingsPath(area.id, to.sectionId)); }}
      searchQuery={query}
      onSearchChange={(next) => setParams((current) => { const updated = new URLSearchParams(current); if (next) updated.set("q", next); else updated.delete("q"); return updated; }, { replace: true })}
      onBack={() => { if (confirmRouteLeave()) navigate(settingsPath(area.id)); }}
    >
      {content}
    </SettingsShell>
  );
}
