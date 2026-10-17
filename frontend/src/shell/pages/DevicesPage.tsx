import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsShell } from "@maipai/ui/src/settings/SettingsShell";
import type { SettingsAreaDef } from "@maipai/ui/src/settings/settingsAudience";
import type { Roster } from "@/lib/api";
import { baseViewer } from "@/shell/pages/settings/settingsViewer";
import "@/shell/pages/settings/settingsTokens.css";
import { getIcon } from "@maipai/ui/src/icons";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { useTabItem } from "@/shell/tabIdentity";

export const DevicesIcon = getIcon("monitor");

const DEVICES_AREA: SettingsAreaDef = {
  id: "devices", title: "Settings", audience: { min_role: "guest" },
  groups: [{ label: "This device", sections: ["devices"] }],
  sections: [{ id: "devices", label: "Devices", icon: "monitor", kind: "view", view: "devices" }],
};

/** Current-person devices and sessions, using the existing scoped section. */
export function DevicesPage({ person }: { person: Roster }) {
  useTabItem("Devices");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  return (
    <SettingsShell area={DEVICES_AREA} viewer={baseViewer(person)} activeSection="devices" layout="docked" contentAs="section" sectionHref={() => "/devices"} onNavigate={() => navigate("/devices")} searchQuery={search} onSearchChange={setSearch} onBack={() => navigate("/settings/account")}>
      <DevicesSection search={search} />
    </SettingsShell>
  );
}
