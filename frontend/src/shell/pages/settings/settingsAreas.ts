import { areaText } from "../../../lib/settingCopy";
import areasFile from "@maipai/spec/settings/areas.json";
import type { SettingsAreaDef } from "@maipai/ui/src/settings/settingsAudience";

const clockArea: SettingsAreaDef = {
  id: "clock", title: "Clock", audience: { min_role: "child" },
  groups: [{ label: "Clock", sections: ["clock"] }],
  sections: [{ id: "clock", label: "Clock", icon: "clock", kind: "keys", scope: "person", cards: [{ scope: "person", group: "person.clock", label: "Alarms" }] }],
};

export const SETTINGS_AREAS = [...(areasFile.areas as unknown as SettingsAreaDef[]), clockArea].map((area) => ({
  ...area,
  sections: area.sections.map((section) => ({
    ...section,
    ...(section.kind === "keys" && (!(section.cards?.length) && section.tabs?.some((tab) => tab.view)) ? { kind: "view" as const } : {}),
    ...(section.id === "apps" && section.tabs ? { tabs: section.tabs.map((tab) => ({ ...tab, ...(tab.id === "robot" ? { view: "home.devices_admin" } : {}) })) } : {}),
    ...(section.id === "household" && section.tabs ? { tabs: section.tabs.map((tab) => tab.id === "people" ? { ...tab, view: "home.users_admin" } : tab) } : {}),
    ...(section.id === "advanced" ? { tabs: section.tabs?.map((tab) => tab.id === "developer" ? { ...tab, view: "home.routing_stats" } : tab) } : {}),
    ...(section.id === "data" ? { tabs: section.tabs?.map((tab) => tab.id === "data" ? { ...tab, view: "account.memories" } : tab) } : {}),
    // STACK-MENU-SYNC-01: the Models tab draws the AI and models page itself (`home.engine_admin`), so its glance and always-on cards are not drawn a second time.
    ...(section.cards ? { cards: section.cards.filter((card) => card.group !== "household.news" && !(section.id === "stack" && ["ai.glance", "ai.always_on"].includes(card.view ?? ""))).map((card) => ({
      ...card,
      ...(card.links ? { links: card.links.map((link) => link.label === "Memories" ? { ...link, href: "/settings/data?tab=data" } : link) } : {}),
    })) } : {}),
  })),
}));

SETTINGS_AREAS.push({ id: "house", title: "House", audience: { min_role: "admin" }, groups: [{ label: "House", sections: ["house"] }], sections: [{ id: "house", label: "House", icon: "house", kind: "view", view: "home.house_admin", min_role: "admin" }] } as SettingsAreaDef);

/** The area with every title and label in the active language (the spec English is the key; an unknown label stays English). */
function localizeArea<T>(node: T): T {
  if (Array.isArray(node)) return node.map(localizeArea) as T;
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, (k === "title" || k === "label") && typeof v === "string" ? areaText(v) : localizeArea(v)])) as T;
  return node;
}

export function settingsArea(id: string | undefined): SettingsAreaDef | undefined {
  const area = SETTINGS_AREAS.find((candidate) => candidate.id === id);
  return area && localizeArea(area);
}

/** `/settings/<section>[/<detailId>][?tab=<tab>][#<key>]`. */
export function settingsPath(section?: string, tab?: string, key?: string, detailId?: string): string {
  const path = `/settings${section ? `/${section}` : ""}${detailId ? `/${encodeURIComponent(detailId)}` : ""}`;
  const query = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  return `${path}${query}${key ? `#${key}` : ""}`;
}

export function placeForGroup(group: string, scope: "household" | "person" | "device"): { area: string; section: string; tab?: string } | undefined {
  for (const area of SETTINGS_AREAS) for (const section of area.sections) {
    const card = (section.cards ?? []).find((candidate) => candidate.group === group && candidate.scope === scope && !candidate.levels);
    if (card) return { area: area.id, section: section.id, tab: card.tab };
  }
  return undefined;
}
