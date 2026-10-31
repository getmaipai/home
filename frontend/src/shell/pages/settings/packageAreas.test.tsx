import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { mockHome, makePerson } from "@/shell/pages/settings/settingsTestKit";
import type { AppRow } from "@/lib/api";
import { packageAreasFrom } from "@/shell/pages/settings/packageAreas";
import { SettingsView } from "@/shell/pages/settings/settingsViews";

afterEach(cleanup);

const row = (extra: Partial<AppRow> = {}) => ({
  package: "demo", label: "Demo", to: "/apps/demo",
  settings_area: { id: "demo", title: "Demo", app: "/apps/demo", groups: [{ label: "Demo", sections: ["places"] }], sections: [{ id: "places", label: "Places", icon: "map-pin", kind: "keys" }] },
  ...extra,
}) as unknown as AppRow;

describe("an app's settings carry a Sidebar section (owner, 2026-10-25)", () => {
  test("every package area gains one Sidebar section in its first group, once", () => {
    const [area] = packageAreasFrom([row()]);
    expect(area!.sections.map((section) => section.id)).toEqual(["places", "sidebar"]);
    expect(area!.groups[0]!.sections).toEqual(["places", "sidebar"]);
    expect(area!.sections[1]).toMatchObject({ kind: "view", view: "app.pin:/apps/demo" });
    const [again] = packageAreasFrom([row({ settings_area: area as never })]);
    expect(again!.sections.filter((section) => section.id === "sidebar").length).toBe(1);
  });

  test("the switch pins and unpins the app through ui.pinned_apps", async () => {
    const home = mockHome();
    try {
      const client = createQueryClient();
      const view = render(<QueryClientProvider client={client}><SettingsView view="app.pin:/apps/demo" person={makePerson("adult")} onPersonChange={() => {}} /></QueryClientProvider>);
      const toggle = await view.findByRole("switch", { name: "Show in the sidebar" });
      await waitFor(() => expect(toggle.getAttribute("aria-disabled")).not.toBe("true"));
      await act(async () => { fireEvent.click(toggle); });
      await waitFor(() => expect(home.puts.some((put) => put.key === "ui.pinned_apps" && put.value === JSON.stringify(["/reminders", "/clock", "/apps/demo"]))).toBe(true));
    } finally {
      home.restore();
    }
  });
});
