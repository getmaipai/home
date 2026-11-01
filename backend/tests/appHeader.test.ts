// MEDIA-HEADER-01: the header buttons the hub hands each person, reduced to what they may open.
import { expect, test } from "bun:test";
import { headerFor } from "@/lib/apps";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PersonRow } from "@/db/schema";

const person = (role: string): PersonRow => ({ role } as PersonRow);
const manifest = { id: "demo", min_role: "child" } as PackageManifest;
const open = (page: string) => ({ navigate: { to: `/apps/demo/${page}` } });
const contributes = {
  pages: [
    { id: "play", module: "play.json" },
    { id: "make", module: "make.json", min_role: "adult" },
    { id: "find", module: "find.json" },
  ],
  header: {
    search: { label: "Search Demo" },
    modes: [
      { id: "play", label: "Play", page: "play" },
      { id: "create", label: "Create", page: "make" },
    ],
    actions: { primary: { label: "New", open: open("make") }, more: [{ label: "Find", open: open("find") }] },
  },
} as never;
const sidebar = { search: { page: "find" }, groups: [] } as never;

test("an adult gets the search, both modes and the actions", () => {
  const header = headerFor(person("adult"), manifest, contributes, sidebar);
  expect(header?.search).toEqual({ label: "Search Demo" });
  expect(header?.modes?.map((mode) => mode.id)).toEqual(["play", "create"]);
  expect(header?.actions?.primary?.label).toBe("New");
  expect(header?.actions?.more?.map((item) => item.label)).toEqual(["Find"]);
});

test("a child loses the Create mode and the action that opens its page, and keeps the rest", () => {
  const header = headerFor(person("child"), manifest, contributes, sidebar);
  expect(header?.modes?.map((mode) => mode.id)).toEqual(["play"]);
  expect(header?.actions?.primary).toBeUndefined();
  expect(header?.actions?.more?.map((item) => item.label)).toEqual(["Find"]);
});

test("the search is dropped when the app has no sidebar search to open", () => {
  expect(headerFor(person("adult"), manifest, contributes, undefined)?.search).toBeUndefined();
});

test("an app with no header contributes none", () => {
  expect(headerFor(person("adult"), manifest, { pages: [] } as never, undefined)).toBeUndefined();
});
