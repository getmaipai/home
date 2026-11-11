// A locked item is hidden from the Library with one flag (`locked`) that makes the page show the Locked items tile; once the person unlocks, the item
// comes back marked `unlocked` so its card can show an open lock. A minor never gets the flag.
import { createHash } from "node:crypto";
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { listLibrary } from "@/lib/library";
import { __resetAdultLockForTests, __unlockedForTests } from "@/lib/adultLock";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

beforeEach(() => { resetDb(); __resetAdultLockForTests(); });

async function owner() {
  const client = new TestClient();
  const result = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  const person = db.select().from(people).where(eq(people.id, result.person.id)).get() as unknown as PersonRow;
  let n = 0;
  const file = (provenance: string) => {
    const key = `file-${(++n).toString(16).padStart(16, "0")}`;
    db.insert(attachments).values({ id: key, ownerPersonId: person.id, conversationId: null, turnId: null, mediaType: "image/png", size: n + 1, sha256: createHash("sha256").update(key).digest("hex"), storagePath: `people/${person.id}/attachments/${key}`, provenance, createdAt: new Date(2026, 0, n).toISOString(), hlc: nextHlc() }).run();
    return key;
  };
  return { person, file };
}

test("a locked item leaves the list and the page says so with one flag, no count", async () => {
  const { person, file } = await owner();
  const open = file('picture-gen:{"audience":"all-ages"}');
  file('picture-gen:{"audience":"adult-only"}');
  file('picture-gen:{"audience":"adult-only"}');
  const page = listLibrary(person, {});
  expect(page.items.map((item) => item.id)).toEqual([open]);
  expect(page.locked).toBe(true);
  expect(page.items[0]).toMatchObject({ unlocked: false });
  expect(JSON.stringify(page)).not.toMatch(/"locked":\s*[2-9]/);
});

test("no locked item, no flag", async () => {
  const { person, file } = await owner();
  file('picture-gen:{"audience":"all-ages"}');
  expect(listLibrary(person, {}).locked).toBe(false);
});

test("an item whose lock was removed is an ordinary item: no flag, no open lock", async () => {
  const { person, file } = await owner();
  file('picture-gen:{"audience":"adult-only","lock":"off"}');
  const page = listLibrary(person, {});
  expect(page.locked).toBe(false);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({ unlocked: false });
});

test("after the unlock the locked items show, marked unlocked, and the flag goes away", async () => {
  const { person, file } = await owner();
  const plain = file('picture-gen:{"audience":"all-ages"}');
  const locked = file('picture-gen:{"audience":"adult-only"}');
  const page = __unlockedForTests(person.id, () => listLibrary(person, {}));
  expect(page.locked).toBe(false);
  const byId = Object.fromEntries(page.items.map((item) => [item.id, item]));
  expect(byId[locked]).toMatchObject({ unlocked: true });
  expect(byId[plain]).toMatchObject({ unlocked: false });
});

test("the flag follows the view: a search that matches no locked item shows no tile", async () => {
  const { person, file } = await owner();
  file('picture-gen:{"audience":"adult-only","prompt":"zebra"}');
  file('picture-gen:{"audience":"all-ages","prompt":"giraffe"}');
  expect(listLibrary(person, { search: "giraffe" }).locked).toBe(false);
  expect(listLibrary(person, { search: "zebra" }).locked).toBe(true);
});
