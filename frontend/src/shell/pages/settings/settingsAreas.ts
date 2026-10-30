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
    // MEM-SPACE-04: the Performance tab (admins only), drawn by the ai.performance view; before Coding. Owed to the settings spec's area file.
    ...(section.id === "ai" && section.tabs ? { tabs: [...section.tabs.filter((tab) => tab.id !== "coding"), { id: "performance", label: "Performance", min_role: "admin" as const, view: "ai.performance" }, ...section.tabs.filter((tab) => tab.id === "coding")].map((tab) => ({ ...tab, ...(["overview", "models", "engines", "advanced"].includes(tab.id) ? { view: "home.engine_admin" } : {}) })) } : {}),
    ...(section.id === "ai" && section.cards ? { cards: section.cards.map((card) => ["household.coding", "household.coding_people", "household.coding_limits"].includes(card.group ?? "") ? { ...card, tab: "coding" } : card) } : {}),
    ...(section.id === "apps" && section.tabs ? { tabs: section.tabs.map((tab) => ({ ...tab, ...(tab.id === "robot" ? { view: "home.devices_admin" } : {}) })) } : {}),
    ...(section.id === "advanced" ? { tabs: [{ id: "developer", label: "Developer tools", view: "home.routing_stats" }, { id: "network", label: "Network and access" }], cards: section.cards?.map((card) => card.group === "household.network_port" ? { ...card, tab: "network" } : card) } : {}),
    ...(section.id === "data" ? { tabs: section.tabs?.map((tab) => tab.id === "data" ? { ...tab, view: "account.memories" } : tab) } : {}),
    ...(section.cards ? { cards: section.cards.filter((card) => card.group !== "household.news").map((card) => ({
      ...card,
      ...(card.links ? { links: card.links.map((link) => link.label === "Memories" ? { ...link, href: "/settings/data?tab=data" } : link) } : {}),
    })) } : {}),
  })),
}));

export function settingsArea(id: string | undefined): SettingsAreaDef | undefined {
  return SETTINGS_AREAS.find((area) => area.id === id);
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
