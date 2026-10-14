import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { UsersSection } from "@/apps/settings/UsersSection";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";

afterEach(cleanup);

const companionKey = SettingsKey.parse({
  key: "companions.allowed", scope: "person", selector: "boolean", layers: ["household", "person"], merge: "override",
  default: true, label: "AI companions", help: "AI companions are on by default.", level: "basic", lives_in: "person.companions", honoured_by: ["home"],
});

function rosterEntry(id: string, role: string, display_name: string): PersonRosterEntry {
  return { id, role, display_name, age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult" } as PersonRosterEntry;
}

test("the add form's companions box defaults to the household value", async () => {
  const people = spyOn(api, "people").mockResolvedValue([rosterEntry("kid", "child", "Robin")] as never);
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([companionKey] as never);
  const values = spyOn(api, "settingsValues").mockImplementation(async (scope, key) => {
    if (key) return [{ key, value: true, source: "default", label: "AI companions", help: companionKey.help, level: "basic", secret: false }];
    if (scope === "household") return [{ key: "companions.allowed", value: false, source: "user", label: "AI companions", help: companionKey.help, level: "basic", secret: false }];
    return [];
  });
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><UsersSection person={{ id: "owner", role: "owner", display_name: "Sage" } as Roster} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(view.getAllByRole("checkbox", { name: "AI companions" }).length).toBe(1));
    expect(view.getByRole("checkbox", { name: "AI companions" }).getAttribute("aria-checked")).toBe("false");
    expect(view.getAllByRole("switch", { name: "AI companions" })).toHaveLength(2);
  } finally { people.mockRestore(); registry.mockRestore(); values.mockRestore(); }
});

test("the person-editor switch is shown to owner and admin for every role, including child and teen", async () => {
  const rows = [
    rosterEntry("owner-one", "owner", "Sage"), rosterEntry("admin-one", "admin", "Avery"),
    rosterEntry("adult-one", "adult", "Jordan"), rosterEntry("teen-one", "teen", "Marlow"),
    rosterEntry("child-one", "child", "Robin"), rosterEntry("guest-one", "guest", "Guest"),
  ];
  const people = spyOn(api, "people").mockResolvedValue(rows as never);
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([companionKey] as never);
  const values = spyOn(api, "settingsValues").mockImplementation(async (scope, key) => {
    if (key === "companions.allowed") return [{ key, value: true, source: "default", label: companionKey.label, help: companionKey.help, level: "basic", secret: false }];
    if (scope === "household") return [{ key: "companions.allowed", value: true, source: "default", label: companionKey.label, help: companionKey.help, level: "basic", secret: false }];
    return [];
  });
  try {
    for (const role of ["owner", "admin"] as const) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(<QueryClientProvider client={client}><MemoryRouter><UsersSection person={{ id: `${role}-id`, role, display_name: "Sage" } as Roster} /></MemoryRouter></QueryClientProvider>);
      await waitFor(() => expect(view.getAllByRole("switch", { name: "AI companions" }).length).toBe(rows.length + 1));
      view.unmount();
    }
  } finally { people.mockRestore(); registry.mockRestore(); values.mockRestore(); }
});
