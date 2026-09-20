import { expect, test } from "bun:test";
import { routeHeader } from "./routeHeader";
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

test("a nested route matches its ancestor destination, not the root", () => {
  expect(routeHeader("/settings/models", person).title).toBe("Settings");
  expect(routeHeader("/people/person-abc123", person).title).toBe("People");
});

test("an unregistered route falls back rather than showing a stale title", () => {
  expect(routeHeader("/nothing-registered", person)).toEqual({ title: "MaiPai Home", subtitle: "" });
});
