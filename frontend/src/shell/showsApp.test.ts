import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PageNodeSchema } from "@maipai/ui/src/schema/types";

const root = resolve(import.meta.dir, "../../../backend/packages/shows");
const pages = resolve(root, "pages");
type Node = Record<string, unknown> & { type?: string; body?: Node[]; main?: Node[]; aside?: Node[] };
const nodesOf = (file: string): Node[] => {
  const out: Node[] = [];
  const walk = (list: Node[] | undefined) => { for (const node of list ?? []) { out.push(node); walk(node.main); walk(node.aside); } };
  walk((JSON.parse(readFileSync(resolve(pages, file), "utf8")) as Node).body);
  return out;
};

test("every Shows page uses the shipped page schema", () => {
  for (const file of readdirSync(pages)) {
    const parsed = PageNodeSchema.safeParse(JSON.parse(readFileSync(resolve(pages, file), "utf8")));
    expect({ file, errors: parsed.success ? [] : parsed.error.issues }).toEqual({ file, errors: [] });
  }
});

test("Shows pages use the shipped media variants: poster grids, pill pickers, the highlighted next episode", () => {
  const shelf = (file: string, heading: string) => nodesOf(file).find((node) => node.type === "media_shelf" && node.heading === heading)!;
  expect(shelf("shows.json", "Shows")).toMatchObject({ layout: "grid", aspect: "poster" });
  expect(shelf("films.json", "Films")).toMatchObject({ layout: "grid", aspect: "poster" });
  expect(shelf("watchlist.json", "Watchlist")).toMatchObject({ layout: "grid", aspect: "poster" });
  expect(nodesOf("show.json").find((node) => node.type === "picker")).toMatchObject({ variant: "pill", state: "season" });
  expect(shelf("show.json", "Episodes")).toMatchObject({ orientation: "vertical", item_highlight_field: "up_next", item_progress_field: "progress", item_meta_field: "duration_s" });
  expect(nodesOf("index.json").find((node) => node.type === "billboard")).toMatchObject({ size: "hero" });
});

test("every data id a Shows page binds is declared by the manifest", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as { contributes: { data: Array<{ id: string }> } };
  const declared = manifest.contributes.data.map((entry) => entry.id);
  for (const file of readdirSync(pages)) {
    for (const node of nodesOf(file)) {
      const path = (node.bind as { path?: string } | undefined)?.path;
      if (path) expect({ file, path, ok: declared.includes(path) }).toEqual({ file, path, ok: true });
    }
  }
});
