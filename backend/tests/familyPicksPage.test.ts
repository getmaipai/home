import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { mediaAppData } from "@/lib/media/appHost";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

describe("Family Picks page", () => {
  test("shows the accessible item rows to owner, teen and child, with viewer vote state", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const addPerson = async (displayName: string, role: string) => {
      const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
      const id = ((await made.json()) as { id: string }).id;
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
      return { client, id };
    };
    const teen = await addPerson("Marlow", "teen");
    const child = await addPerson("Nova", "child");
    const tree = buildMediaTree();
    const source = await owner.post("/api/media/sources", { label: "videos", path: tree.videos, kinds: ["video"] });
    await scanRoot(((await source.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    const films = (await (await owner.post("/api/plugins/video/data/library", {})).json()) as Array<{ id: string }>;
    const id = films[0]!.id;
    expect((await owner.post("/api/plugins/video/picks/add", { media_id: id })).status).toBe(200);
    const ownerRows = mediaAppData(db.select().from(people).where(eq(people.displayName, "Sage")).get()!, "video", "library", { scope: "family-picks" }) as unknown as Array<Record<string, unknown>>;
    expect(ownerRows).toHaveLength(1);
    expect((ownerRows as Array<Record<string, unknown>>)[0]).toMatchObject({ id, top_label: "Top pick", vote_count: 0, voted: false, added_by_name: "Sage" });
    expect((await teen.client.post("/api/plugins/video/picks/vote", { media_id: id })).status).toBe(200);
    const teenRows = (await (await teen.client.post("/api/plugins/video/data/library", { scope: "family-picks" })).json()) as Array<Record<string, unknown>>;
    expect(teenRows[0]).toMatchObject({ vote_count: 1, voted: true, vote_action_label: "Remove vote" });
    const childRows = (await (await child.client.post("/api/plugins/video/data/library", { scope: "family-picks" })).json()) as Array<Record<string, unknown>>;
    expect(childRows[0]).toMatchObject({ id, vote_count: 1, voted: false });
  });

  test("adds a pick from the video action and toggles the caller's vote", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const tree = buildMediaTree();
    const source = await owner.post("/api/media/sources", { label: "videos", path: tree.videos, kinds: ["video"] });
    await scanRoot(((await source.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    const film = ((await (await owner.post("/api/plugins/video/data/library", {})).json()) as Array<{ id: string }>)[0]!;
    expect((await owner.post("/api/plugins/video/picks/add", { media_id: film.id })).status).toBe(200);
    expect((await owner.post("/api/plugins/video/picks/vote", { media_id: film.id })).status).toBe(200);
    const rows = (await (await owner.post("/api/plugins/video/data/library", { scope: "family-picks" })).json()) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ voted: true, vote_action_label: "Remove vote" });
    await owner.post("/api/plugins/video/picks/vote", { media_id: film.id });
    const cleared = (await (await owner.post("/api/plugins/video/data/library", { scope: "family-picks" })).json()) as Array<Record<string, unknown>>;
    expect(cleared[0]).toMatchObject({ voted: false, vote_action_label: "Vote" });
  });
});
