// PODCASTS-MENU-01: the Podcasts menu is grouped like Audio's (Browse and Create), every row has a page, and the Create tab is adult-only.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../packages/podcasts");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
  contributes: {
    sidebar: { groups: Array<{ id: string; mode?: string; title?: string; pages: string[] }> };
    header: { modes: Array<{ id: string; page: string }> };
    pages: Array<{ id: string; module: string; min_role?: string }>;
  };
};

test("Browse and Create are grouped, within the six-group cap, with the planned headings", () => {
  const groups = manifest.contributes.sidebar.groups;
  expect(groups).toHaveLength(6);
  expect(groups.filter((group) => group.mode === "play").map((group) => group.title ?? "")).toEqual(["", "Discover", "Library", "Tools"]);
  expect(groups.filter((group) => group.mode === "create").map((group) => group.title)).toEqual(["Make", "Edit"]);
});

test("every row names a page, and every page has its file", () => {
  const ids = new Set(manifest.contributes.pages.map((page) => page.id));
  for (const group of manifest.contributes.sidebar.groups) for (const id of group.pages) expect(ids.has(id)).toBe(true);
  for (const page of manifest.contributes.pages) expect(existsSync(join(dir, "pages", `${page.module}.json`))).toBe(true);
});

test("the Create tab opens on an adult-only page, and its coming-soon rows are adult-only too", () => {
  const byId = new Map(manifest.contributes.pages.map((page) => [page.id, page]));
  const create = manifest.contributes.header.modes.find((mode) => mode.id === "create")!;
  expect(byId.get(create.page)?.min_role).toBe("adult");
  for (const id of ["make-podcast", "record", "podcast-voices", "chapters", "transcripts", "cover-art"]) expect(byId.get(id)?.min_role).toBe("adult");
});
