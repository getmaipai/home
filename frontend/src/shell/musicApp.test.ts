import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PageNodeSchema } from "@maipai/ui/src/schema/types";
import { playRoute } from "./mediaApps";
const pages = resolve(import.meta.dir, "../../../backend/packages/music/pages");
test("every Music page uses the shipped page schema", () => {
  for (const file of readdirSync(pages)) {
    const parsed = PageNodeSchema.safeParse(JSON.parse(readFileSync(resolve(pages,file),"utf8")));
    expect({file, errors: parsed.success ? [] : parsed.error.issues}).toEqual({file,errors:[]});
  }
});
test("Music uses the audio player and routes tracks to Now playing", () => {
  const doc=JSON.parse(readFileSync(resolve(pages,"play.json"),"utf8"));
  expect(doc.body[0].main[0]).toMatchObject({type:"player",kind:"audio",layout:"audio",autoplay_next:true});
  expect(playRoute("track","media-song000001")).toBe("/apps/music/play?id=media-song000001");
});

test("a music element requests autoplay for queue transitions", async () => {
  const { createMediaStore } = await import("./mediaHost");
  const store = createMediaStore();
  const element = store.elementFor({id:"media-song000001",src:"/api/media/items/media-song000001/content",kind:"audio",title:"Garden"},"music");
  expect(element.autoplay).toBe(true);
  store.clear();
});

type Node = Record<string, unknown> & { type?: string; body?: Node[]; main?: Node[]; aside?: Node[] };
const nodesOf = (file: string): Node[] => {
  const out: Node[] = [];
  const walk = (list: Node[] | undefined) => { for (const node of list ?? []) { out.push(node); walk(node.main); walk(node.aside); } };
  walk((JSON.parse(readFileSync(resolve(pages, file), "utf8")) as Node).body);
  return out;
};

test("Music pages use the shipped media variants: grids, round artist art, compact rows with index, running time and the playing ring", () => {
  const shelf = (file: string, heading: string) => nodesOf(file).find((node) => node.type === "media_shelf" && node.heading === heading)!;
  expect(shelf("albums.json", "Albums")).toMatchObject({ layout: "grid", aspect: "square", variant: "plain" });
  expect(shelf("artists.json", "Artists")).toMatchObject({ layout: "grid", art_shape: "circle" });
  expect(shelf("index.json", "Radio from your music")).toMatchObject({ art_shape: "circle" });
  expect(shelf("album.json", "Tracks")).toMatchObject({ orientation: "vertical", density: "compact", item_index_field: "track_number", item_meta_field: "duration_s", item_highlight_field: "playing" });
  expect(shelf("songs.json", "Songs")).toMatchObject({ orientation: "vertical", density: "compact", item_highlight_field: "playing" });
  expect(shelf("play.json", "Up next")).toMatchObject({ orientation: "vertical", density: "compact" });
  const remove = (shelf("playlist.json", "Songs").row_actions as Array<{ label: string }>) ?? [];
  expect(remove.map((action) => action.label)).toEqual(["Remove"]);
});

test("every data id a Music page binds is declared by the manifest, and the manifest stays inside the 16-id cap", () => {
  const manifest = JSON.parse(readFileSync(resolve(pages, "../manifest.json"), "utf8")) as { contributes: { data: Array<{ id: string }> } };
  const declared = manifest.contributes.data.map((entry) => entry.id);
  expect(declared.length).toBeLessThanOrEqual(16);
  for (const file of readdirSync(pages)) {
    for (const node of nodesOf(file)) {
      const path = (node.bind as { path?: string } | undefined)?.path;
      if (path) expect({ file, path, ok: declared.includes(path) }).toEqual({ file, path, ok: true });
    }
  }
});
