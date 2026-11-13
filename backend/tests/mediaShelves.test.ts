// MEDIA-SHELVES-01 (2026-11-07): every data id the Music, Videos and Podcasts pages bind answers 200 for the owner, an adult, a teen and a
// child, with a library and watch progress in place. A shelf whose request fails shows the kit's "Could not load this shelf.", so a
// non-200 here is what Jesse saw on his phone. Ids are read from the package page documents, so a renamed or deleted handler fails here.
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests } from "@/lib/media/progress";
import { __resetRadioDirectoryForTests } from "@/lib/media/radioDirectory";
import { buildMediaTree } from "./support/mediaTree";

beforeEach(() => { resetDb(); __resetProgressForTests(); __resetRadioDirectoryForTests(); });

type Bind = { path: string; params: Record<string, unknown> };
function bindsOf(app: string): Bind[] {
  const dir = join(import.meta.dir, "..", "packages", app, "pages");
  const found = new Map<string, Bind>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const bind = (node as { bind?: { path?: unknown; params?: Record<string, unknown> } }).bind;
    if (bind && typeof bind.path === "string") {
      // A `$state.x` param is the person's own choice on the page: leave it out (an empty id answers an empty list, not an error).
      const params = Object.fromEntries(Object.entries(bind.params ?? {}).filter(([, v]) => !(typeof v === "string" && v.startsWith("$"))));
      found.set(`${bind.path}${JSON.stringify(params)}`, { path: bind.path, params });
    }
    Object.values(node).forEach(walk);
  };
  for (const file of readdirSync(dir)) if (file.endsWith(".json")) walk(JSON.parse(readFileSync(join(dir, file), "utf8")));
  return [...found.values()];
}

// Ids that read one named record: with no id they answer a calm refusal on purpose; the page always supplies the id.
const NEEDS_ID = new Set(["creation", "header", "item", "up-next", "playlist", "artist", "album", "album-more", "artist-albums"]);

describe("every shelf data id of the media apps answers 200", () => {
  test("music, videos and podcasts, for each role, with progress recorded", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const make = async (displayName: string, role: string, birthdate?: string) => {
      const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(birthdate ? { birthdate } : {}) });
      const created = (await made.json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
      return client;
    };
    const clients: Record<string, TestClient> = {
      owner, adult: await make("Marlow", "adult"), teen: await make("Nova", "teen", "2011-03-01"), child: await make("Sprout", "child", "2018-03-01"),
    };
    const tree = buildMediaTree();
    for (const [label, path, kind] of [["videos", tree.videos, "video"], ["music", tree.music, "track"]] as const) {
      const added = await owner.post("/api/media/sources", { label, path, kinds: [kind] });
      await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    }
    // Watch progress for the owner, so the Continue, History and Again shelves have rows to build.
    for (const app of ["video", "audio"]) {
      const library = (await (await owner.post(`/api/plugins/${app}/data/library`, {})).json()) as Array<{ id: string }>;
      for (const row of library.slice(0, 3)) await owner.post(`/api/plugins/${app}/progress`, { media_id: row.id, position_s: 3, duration_s: 20 });
    }
    const failures: string[] = [];
    let checked = 0;
    for (const app of ["audio", "video", "podcasts"]) {
      for (const bind of bindsOf(app)) {
        if (NEEDS_ID.has(bind.path)) continue;
        for (const [who, client] of Object.entries(clients)) {
          // The Videos Create, Studio and Clips pages are adult-only on purpose (rule 0): a teen and a child get 404 there.
          if (app === "video" && bind.path === "recipes" && (who === "teen" || who === "child")) continue;
          const res = await client.post(`/api/plugins/${app}/data/${bind.path}`, bind.params);
          checked += 1;
          if (res.status !== 200) failures.push(`${who} ${app}/${bind.path} ${JSON.stringify(bind.params)} -> ${res.status} ${(await res.text()).slice(0, 120)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  }, 120_000);
});
