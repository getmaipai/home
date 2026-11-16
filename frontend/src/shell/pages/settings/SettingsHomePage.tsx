import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button"
import { SettingsShell } from "@maipai/ui/src/settings/SettingsShell";
import { sectionVisible, type SettingsAreaDef, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { getIcon } from "@maipai/ui/src/icons";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { PageHeaderTitle } from "@/shell/pageHeaderTitle";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";
import { baseViewer } from "@/shell/pages/settings/settingsViewer";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { settingsArea } from "@/shell/pages/settings/settingsAreas";
import { Fragment, useState } from "react";
import { formatDate } from "@/lib/format";

const emptyArea: SettingsAreaDef = { id: "settings", title: "Settings", audience: { min_role: "child" }, groups: [], sections: [] };

export function SettingsHomePage({ person }: { person: Roster }) {
  useHeaderExtra(PageHeaderTitle);
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const phone = breakpoint.under(720);
  const [query, setQuery] = useState("");
  const attention = useQuery({ queryKey: ["settings-attention"], queryFn: api.settingsAttention, staleTime: 30_000 });
  const viewer: SettingsViewer = { ...baseViewer(person), role: person.role === "owner" ? "admin" : person.role };
  const area = settingsArea("settings") ?? emptyArea;
  const visibleSections = area.sections.filter((section) => sectionVisible(section, viewer));
  const groups = area.groups.map((group) => [group.label, group.sections.map((id) => visibleSections.find((section) => section.id === id)).filter((section) => section && section.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))] as [string, typeof visibleSections]).filter(([, sections]) => sections.length && (isOwnerOrAdminRole(person.role) || sections.some((section) => section.scope !== "household" && section.min_role !== "admin")));
  const personalGroup = groups.find(([label]) => label === "Yours");
  const homeGroup = groups.find(([label]) => label === "The home");
  const shownGroups: Array<[string, typeof visibleSections]> = [
    [i18n._({ id: "Yours", message: "Yours" }), personalGroup?.[1] ?? []],
    ...(isOwnerOrAdminRole(person.role) && homeGroup?.[1].length ? [[i18n._({ id: "The home", message: "The home" }), homeGroup[1]] as [string, typeof visibleSections]] : []),
  ];
  const rows = attention.data?.areas ?? {};
  const summary = attention.data;
  return <SettingsShell
    layout={phone ? "default" : "docked"}
    area={{ ...area, title: i18n._({ id: "Overview", message: "Overview" }) }}
    viewer={viewer}
    labels={{ columnTitle: i18n._({ id: "Settings", message: "Settings" }), search: i18n._({ id: "Find a setting", message: "Find a setting" }) }}
    activeSection={undefined}
    sectionHref={(id) => settingsPath(id)}
    searchQuery={query}
    onSearchChange={setQuery}
    onNavigate={(to) => navigate(to.href)}
  >
    <div className="flex flex-col gap-6">
      <header><p className="text-supporting text-muted-foreground">{i18n._({ id: "{name}, {role} · checked just now", message: "{name}, {role} · checked just now", values: { name: person.display_name, role: person.role } })}</p></header>
      <section aria-labelledby="settings-attention" className="flex flex-col gap-2">
        <h2 id="settings-attention" className="text-section font-semibold">{i18n._({ id: "Needs attention · {count}", message: "Needs attention · {count}", values: { count: summary?.items.length ?? 0 } })}</h2>
        <ItemGroup variant="card">
          {attention.isLoading ? null : (summary?.items.length ?? 0) === 0
            ? <Item size="setting"><ItemContent><ItemTitle>{i18n._({ id: "Everything is fine.", message: "Everything is fine." })}</ItemTitle><ItemDescription>{i18n._({ id: "Checked just now.", message: "Checked just now." })}</ItemDescription></ItemContent></Item>
            : summary!.items.map((item, index) => <Fragment key={item.id}>
              {index > 0 ? <ItemSeparator variant="inset" /> : null}
              <Item size="setting">
                <ItemContent>
                  <ItemTitle>{item.title}</ItemTitle>
                  <ItemDescription clamp={false}>{item.since ? `${item.line} · ${i18n._({ id: "Since {date}", message: "Since {date}", values: { date: formatDate(item.since, { month: "short", day: "numeric" }) } })}` : item.line}</ItemDescription>
                </ItemContent>
                <ItemActions><Button variant="outline" size="row" onClick={() => navigate(item.action.href)}>{item.action.label}</Button></ItemActions>
              </Item>
            </Fragment>)}
        </ItemGroup>
      </section>
      {shownGroups.map(([title, sections]) => sections.length ? <section key={title} className="flex flex-col gap-2"><h2 className="text-section font-semibold">{title}</h2><ItemGroup variant="card" role="list" aria-label={title}>
        {sections.map((section, index) => {
          const state = rows[section.id];
          const Icon = getIcon(section.icon ?? "settings");
          return <Fragment key={section.id}><Item size="setting" variant="default" render={<Link to={settingsPath(section.id)} aria-label={section.label} />}>
            <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
            <ItemContent><ItemTitle>{section.label}</ItemTitle>{state?.summary ? <ItemDescription>{state.summary}</ItemDescription> : null}</ItemContent>
            {state && state.state !== "ok" ? <Badge variant="outline" tone="warning" aria-label={state.state}><span aria-hidden="true" className="size-2 rounded-full bg-current" /></Badge> : null}
          </Item>{index < sections.length - 1 ? <ItemSeparator variant="inset" /> : null}</Fragment>;
        })}
      </ItemGroup></section> : null)}
    </div>
  </SettingsShell>;
}


