import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";

beforeEach(resetDb);

interface Result { kind: string; id: string; title: string; thumbnail?: string }
interface Group { kind: string; results: Result[] }

async function setup() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, person };
}

async function search(client: TestClient, q: string): Promise<Group[]> {
  const res = await client.get(`/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { groups: Group[] }).groups;
}

describe("GET /api/search: thumbnails", () => {
  test("a song made at home carries its Library thumbnail in the Media group", async () => {
    const { client, person } = await setup();
    const stored = storeFile(person, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes: new Uint8Array([4, 5, 6]), provenance: 'music-gen:{"title":"Thumbnail Test Song","duration_seconds":31}', deduplicate: false });
    if (!stored.ok) throw new Error(stored.error);
    const media = (await search(client, "Thumbnail Test")).find((group) => group.kind === "media");
    const hit = media?.results.find((row) => row.id === stored.value.id);
    expect(hit).toBeDefined();
    expect(hit?.thumbnail).toBe(`/api/files/${stored.value.id}/thumb?w=320`);
  });

  test("a picture in the Library keeps its thumbnail in the Files group", async () => {
    const { client, person } = await setup();
    const stored = storeFile(person, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]), deduplicate: false, name: "Harbor sunrise.png" } as never);
    if (!stored.ok) throw new Error(stored.error);
    const files = (await search(client, "Harbor sunrise")).find((group) => group.kind === "file");
    expect(files?.results[0]?.thumbnail).toBe(`/api/files/${stored.value.id}/thumb?w=320`);
  });
});
