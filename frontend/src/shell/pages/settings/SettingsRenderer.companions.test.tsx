import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { api } from "@/lib/api";

afterEach(cleanup);

test("turning companions off hides the personality picker while keeping its stored setting", async () => {
  const companions = SettingsKey.parse({ key: "companions.allowed", scope: "person", selector: "boolean", layers: ["household", "person"], merge: "override", default: true, label: "AI companions", help: "AI companions are on by default.", level: "basic", lives_in: "person.companions", honoured_by: ["home"] });
  const persona = SettingsKey.parse({ key: "persona.active_id", scope: "person", selector: "select", range: { options: ["default", "buddy", "tutor"] }, default: "default", label: "Personality", help: "How MaiPai talks to you.", level: "basic", lives_in: "person.persona", honoured_by: ["home"] });
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([companions, persona] as never);
  const values = spyOn(api, "settingsValues").mockResolvedValue([
    { key: "companions.allowed", value: false, source: "user", label: "AI companions", level: "basic", secret: false },
    { key: "persona.active_id", value: "tutor", source: "user", label: "Personality", level: "basic", secret: false },
  ] as never);
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SettingsRenderer scope="person" scopeValue="person:owner" /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(view.getByText("No settings yet.")).toBeTruthy());
    expect(view.queryByText("Personality")).toBeNull();
    expect(values).toHaveBeenCalledWith("person:owner", undefined);
  } finally { registry.mockRestore(); values.mockRestore(); }
});
