// MEDIA-HEADER-01: which header mode an address belongs to, and the sidebar groups each mode draws.
import { expect, test } from "bun:test";
import { rememberMode, rememberedMode, resolveMode, sidebarInMode } from "./appHeaderModes";

const header = { modes: [{ id: "play", label: "Play", icon: null, page: "index" }, { id: "create", label: "Create", icon: null, page: "make" }] } as never;
const sidebar = {
  groups: [
    { id: "all", pages: [{ page: "index" }] },
    { id: "play", mode: "play", pages: [{ page: "songs" }] },
    { id: "create", mode: "create", pages: [{ page: "studio" }] },
  ],
} as never;

test("a page in a mode's sidebar group, or a mode's landing page, belongs to that mode", () => {
  expect(resolveMode(header, sidebar, "studio", null)).toBe("create");
  expect(resolveMode(header, sidebar, "make", null)).toBe("create");
  expect(resolveMode(header, sidebar, "songs", "create")).toBe("play");
});

test("a page in no mode keeps the remembered mode, and the first mode is the default", () => {
  expect(resolveMode(header, sidebar, "search", "create")).toBe("create");
  expect(resolveMode(header, sidebar, "search", "gone")).toBe("play");
  expect(resolveMode(header, sidebar, "search", null)).toBe("play");
  expect(resolveMode(undefined, sidebar, "search", null)).toBeUndefined();
});

test("a mode draws its own groups and the groups that name no mode", () => {
  expect((sidebarInMode(sidebar, "create") as { groups: Array<{ id: string }> }).groups.map((g) => g.id)).toEqual(["all", "create"]);
  expect(sidebarInMode(sidebar, undefined)).toBe(sidebar);
});

test("the chosen mode is remembered per person and app", () => {
  rememberMode("sage", "demo", "create");
  expect(rememberedMode("sage", "demo")).toBe("create");
  expect(rememberedMode("marlow", "demo")).toBeNull();
});
