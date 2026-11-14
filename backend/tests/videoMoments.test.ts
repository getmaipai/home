// VIDEO-LD-05 (Home side): a viewer's saved moments in a video. Private to the person, gated like the watch page, bounded, and never logged.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { db } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests } from "@/lib/media/progress";
import { getAppPage } from "@/lib/apps";
import { buildMediaTree } from "./support/mediaTree";
import type { PersonRow } from "@/types";

const page = JSON.parse(readFileSync(join(import.meta.dir, "..", "packages", "video", "pages", "watch.json"), "utf8"));
type Row = Record<string, any>;

beforeEach(() => { resetDb(); __resetProgressForTests(); });

async function house() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const make = async (displayName: string, role: string, birthdate?: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(birthdate ? { birthdate } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await make("Marlow", "adult");
  const teen = await make("Nova", "teen", "2011-03-01");
  const child = await make("Sprout", "child", "2018-03-01");
  const added = await owner.post("/api/media/sources", { label: "videos", path: buildMediaTree().videos, kinds: ["video"] });
  await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const library = (await (await owner.post("/api/plugins/video/data/library", {})).json()) as Row[];
  const id = library[0]!.id as string;
  db.update(mediaItems).set({ durationS: 100 }).where(eq(mediaItems.id, id)).run();
  const view = async (client: TestClient, itemId = id) => (await (await client.post("/api/plugins/video/data/item", { id: itemId })).json()) as Row;
  return { owner, adult, teen, child, id, view, library };
}

describe("video moments", () => {
  test("the watch page validates and carries the Save moment action and the marks field", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    expect(ajv.validate(UI_SCHEMA as object, page), JSON.stringify(ajv.errors)).toBe(true);
    const player = page.body[0].main[0];
    expect(player.marks).toEqual({ field: "marks" });
    const save = player.actions.find((a: Row) => a.label === "Save moment");
    expect(save.action.call).toMatchObject({ target: "/api/plugins/video/moment", args: { media_id: "{id}", at_s: "{position_s}" }, success_label: "Moment saved" });
    const owner = db.select().from(people).all()[0] as PersonRow | undefined;
    if (owner) expect(getAppPage(owner, "video", "watch").ok).toBe(true);
  });

  test("an owner saves a moment, sees it in the item view, and removes it", async () => {
    const { owner, id, view } = await house();
    expect((await view(owner)).marks).toEqual([]);
    const saved = await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 75.6 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ at_s: 75, label: "1:15" });
    await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 10 });
    expect((await view(owner)).marks).toEqual([{ at_s: 10, label: "0:10" }, { at_s: 75, label: "1:15" }]);
    expect((await owner.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 10 })).status).toBe(200);
    expect((await view(owner)).marks).toEqual([{ at_s: 75, label: "1:15" }]);
    expect((await owner.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 10 })).status).toBe(404);
    // Saved again after a removal, the moment is back.
    await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 10 });
    expect((await view(owner)).marks).toHaveLength(2);
  });

  test("another person never sees my moments; a teen and a child keep their own", async () => {
    const { owner, adult, teen, child, id, view } = await house();
    await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 20 });
    await teen.client.post("/api/plugins/video/moment", { media_id: id, at_s: 30 });
    expect((await child.client.post("/api/plugins/video/moment", { media_id: id, at_s: 40 })).status).toBe(200);
    expect((await view(owner)).marks).toEqual([{ at_s: 20, label: "0:20" }]);
    expect((await view(teen.client)).marks).toEqual([{ at_s: 30, label: "0:30" }]);
    expect((await view(child.client)).marks).toEqual([{ at_s: 40, label: "0:40" }]);
    expect((await view(adult.client)).marks).toEqual([]);
    // Removing a time only the owner saved changes nothing for the teen.
    expect((await teen.client.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 20 })).status).toBe(404);
    expect((await view(owner)).marks).toHaveLength(1);
  });

  test("a bad time is refused with a plain message", async () => {
    const { owner, id } = await house();
    for (const at_s of [-1, 101, "abc", null, Infinity, "NaN"]) {
      const res = await owner.post("/api/plugins/video/moment", { media_id: id, at_s });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("Save moment");
    }
    expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 100 })).status).toBe(200);
    expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 0 })).status).toBe(200);
  });

  test("at most 200 moments per video; the 201st says what to do", async () => {
    const { owner, id } = await house();
    db.update(mediaItems).set({ durationS: 1000 }).where(eq(mediaItems.id, id)).run();
    for (let at = 0; at < 200; at++) expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: at })).status).toBe(200);
    const over = await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 500 });
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: string }).error).toContain("Remove one");
    // The same time again is not a new moment.
    expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 5 })).status).toBe(200);
    await owner.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 5 });
    expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 500 })).status).toBe(200);
  });

  test("a hidden or band-locked video, or an unknown one, cannot hold a moment", async () => {
    const { owner, teen, child, id } = await house();
    expect((await owner.post("/api/plugins/video/moment", { media_id: "media-nothere00", at_s: 1 })).status).toBe(404);
    db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, id)).run();
    expect((await teen.client.post("/api/plugins/video/moment", { media_id: id, at_s: 1 })).status).toBe(404);
    expect((await child.client.post("/api/plugins/video/moment", { media_id: id, at_s: 1 })).status).toBe(404);
    db.update(mediaItems).set({ hidden: true }).where(eq(mediaItems.id, id)).run();
    expect((await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 1 })).status).toBe(404);
    expect((await owner.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 1 })).status).toBe(404);
  });

  test("a signed-out visitor is refused, and no log line carries the person or the moment", async () => {
    const { owner, id } = await house();
    expect((await new TestClient().post("/api/plugins/video/moment", { media_id: id, at_s: 3 })).status).toBe(401);
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      await owner.post("/api/plugins/video/moment", { media_id: id, at_s: 3 });
      await owner.post("/api/plugins/video/moment/remove", { media_id: id, at_s: 3 });
    } finally { for (const spy of spies) spy.mockRestore(); }
    expect(lines.filter((line) => /Sage|video-moment|0:03/.test(line))).toEqual([]);
  });
});
