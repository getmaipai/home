import { expect, test } from "bun:test";
import { routeHeader, routeTitle } from "./routeHeader";
import { mergeAppCatalog } from "./appCatalog";
import type { Roster } from "@/lib/api";

const person: Roster = {
  id: "person-abc123",
  display_name: "Nova",
  nickname: null,
  role: "owner",
  avatar_seed: "person-abc123",
  source: "hub",
  local_only: false,
  created_at: "2026-09-04T00:00:00.000Z",
  updated_at: "2026-09-04T00:00:00.000Z",
  deleted_at: null,
  enabled: true,
  guest_expires_at: null,
  memorialized_at: null,
  hlc: "1788000000000:0:test",
  hasSecret: true,
};

test("the Home route's subtitle greets the signed-in person", () => {
  const header = routeHeader("/", person);
  expect(header.title).toBe("Home");
  expect(header.subtitle).toContain("Nova");
  expect(header.subtitle).toContain("Here is your household today.");
});

test("every primary destination gets its own title and subtitle", () => {
  expect(routeHeader("/chat", person).title).toBe("Chat");
  expect(routeHeader("/settings", person).title).toBe("Settings");
});

test("catalog pages take their header title from the catalog (issue 187)", () => {
  expect(routeTitle("/people")).toBe("Family");
  expect(routeTitle("/privacy")).toBe("Privacy");
  expect(routeTitle("/reference")).toBe("Reference");
  expect(routeTitle("/storage")).toBeUndefined();
});

test("a nested route matches its ancestor destination, not the root", () => {
  expect(routeHeader("/settings/models", person).title).toBe("Settings");
  expect(routeHeader("/people/person-abc123", person).title).toBe("Family");
});

test("an unregistered route falls back rather than showing a stale title", () => {
  expect(routeHeader("/nothing-registered", person)).toEqual({ title: "MaiPai Home", subtitle: "" });
});

test("a package app route takes its title and subtitle from the merged catalog", () => {
  const apps = mergeAppCatalog([{ package: "demo", page: "index", label: "Demo weather", icon: "cloud-sun", description: "A fixture app.", category: "Utilities", keywords: [], sections: [], to: "/apps/demo", incognito: "unaffected" }], false);
  expect(routeHeader("/apps/demo/week", person, apps)).toEqual({ title: "Demo weather", subtitle: "A fixture app." });
  expect(routeHeader("/apps/demo", person).title).toBe("MaiPai Home");
});
