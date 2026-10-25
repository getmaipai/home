import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { packageAreaKeySet, visibleRegistry } from "@/shell/pages/settings/settingsViewer";
import { api } from "@/lib/api";

afterEach(cleanup);

const home = SettingsKey.parse({ key: "household.home", scope: "household", selector: "location", range: { multiple: false, allow_current: false }, default: null, label: "Home location", help: "The household place used as the fallback for location-based answers.", level: "basic", lives_in: "household.system", honoured_by: ["home", "bot"] });
const previewShells = SettingsKey.parse({ key: "companions.preview_shells", scope: "household", selector: "boolean", default: false, label: "Preview the coming companion features", help: "Everyone in the home sees them.", level: "basic", lives_in: "household.system", honoured_by: ["home"] });
const weatherPlaces = SettingsKey.parse({ key: "weather.places", scope: "person", selector: "location", range: { multiple: true, allow_current: false }, default: [], label: "Weather places", level: "basic", lives_in: "weather.places", honoured_by: ["home"] });

test("only the household home location key reaches the generic cards", () => {
  expect(visibleRegistry([home, weatherPlaces], "adult").map((k) => k.key)).toEqual(["household.home"]);
});

test("the standard household preview switch renders in the Household card", async () => {
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([previewShells] as never);
  const values = spyOn(api, "settingsValues").mockResolvedValue([{ key: previewShells.key, value: false, source: "default", label: previewShells.label, help: previewShells.help, level: previewShells.level, secret: false }] as never);
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SettingsRenderer scope="household" scopeValue="household" only={["household.system"]} /></MemoryRouter></QueryClientProvider>);
    expect(await view.findByRole("switch", { name: previewShells.label })).toBeTruthy();
  } finally { registry.mockRestore(); values.mockRestore(); }
});

test("a location key is drawn only when a package area's card draws its group; a minor sees it too", () => {
  const own = new Set(["weather.places"]);
  expect(visibleRegistry([home, weatherPlaces], "adult", [], own).map((k) => k.key)).toEqual(["household.home", "weather.places"]);
  expect(visibleRegistry([home, weatherPlaces], "child", [], own).map((k) => k.key)).toEqual(["weather.places"]);
  expect(visibleRegistry([home, weatherPlaces], "child").map((k) => k.key)).toEqual([]);
});

test("packageAreaKeySet names the keys a package area's cards draw, by group and scope", () => {
  const area = { id: "weather", sections: [{ id: "places", cards: [{ label: "Places", group: "weather.places", scope: "person" }] }] } as never;
  expect([...packageAreaKeySet([area], [home, weatherPlaces])]).toEqual(["weather.places"]);
});

test("the household home is a kit place picker: search, save a household place, write its id", async () => {
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([home] as never);
  const values = spyOn(api, "settingsValues").mockResolvedValue([{ key: home.key, value: null, source: "default", label: home.label, level: "basic", secret: false }] as never);
  const entities = spyOn(api, "entities").mockResolvedValue([] as never);
  const search = spyOn(api, "searchPlaces").mockResolvedValue([{ name: "Portland", area: "Oregon", lat: 45.52, lon: -122.68 }]);
  const create = spyOn(api, "createEntity").mockResolvedValue({ id: "ent-home", name: "Portland" } as never);
  const set = spyOn(api, "setSetting").mockResolvedValue({ key: home.key, value: "ent-home", source: "user", label: home.label, level: "basic", secret: false } as never);
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SettingsRenderer scope="household" scopeValue="household" only={["household.system"]} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await view.findByText("Set place"));
    const doc = view.baseElement.ownerDocument;
    const input = await waitFor(() => {
      const el = doc.querySelector('input[aria-label="Search for a place"]') as HTMLInputElement | null;
      if (!el) throw new Error("no popover");
      return el;
    });
    fireEvent.change(input, { target: { value: "Portl" } });
    fireEvent.click(await view.findByText("Portland", {}, { timeout: 2000 }));
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ kind: "place", scope: "household", name: "Portland", geo: { lat: 45.52, lon: -122.68, from: "search" } });
    expect(set.mock.calls[0]!.slice(0, 3)).toEqual(["household", "household.home", "ent-home"]);
    expect(search).toHaveBeenCalledTimes(1);
  } finally { registry.mockRestore(); values.mockRestore(); entities.mockRestore(); search.mockRestore(); create.mockRestore(); set.mockRestore(); }
});
