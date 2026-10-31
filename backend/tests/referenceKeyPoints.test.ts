// Key points and Discuss for a reference article (the Wikipedia app), under the same floors as the reader.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetSidecarsForTests, registerSidecar } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { __resetReferenceReaderCachesForTests } from "@/lib/retrieval/referenceReader";
import { __setReferenceKeyPointsModelForTests, readReferenceArticle, referenceItemId } from "@/lib/reference/keyPoints";
import { startFakeKiwix, type FakeKiwix } from "./support/fakeKiwix";

const BOOK = "wikipedia_en_simple_all_maxi_2026-09";
const words = "The river runs from the mountains to the sea and passes through many towns on its way. ".repeat(6);
const html = `<div class="mw-parser-output"><h1>River</h1><p>${words}</p><h2>History</h2><p>${words}</p></div>`;
let kiwix: FakeKiwix | null = null;
const calls: string[] = [];
const reply = JSON.stringify({ intro: "The river runs to the sea.", points: ["It starts in the mountains.", "It passes many towns.", "It ends at the sea."] });

beforeEach(() => {
  resetDb(); __resetSidecarsForTests(); __resetReferenceReaderCachesForTests(); calls.length = 0;
  __setReferenceKeyPointsModelForTests((async (messages: Array<{ content: string }>) => { calls.push(messages[1]!.content); return { ok: true, text: reply }; }) as never);
  kiwix = startFakeKiwix([{ id: BOOK, date: "2026-09-01", articles: { River: { title: "River", html } } }]);
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["true"], port: Number(new URL(kiwix.baseUrl).port) });
});
afterEach(() => { kiwix?.stop(); kiwix = null; __resetSidecarsForTests(); __setReferenceKeyPointsModelForTests(null); });

async function owner() { const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); return c; }
const keyPoints = async (c: TestClient, path = "River") => (await (await c.post(`/api/reference/key-points/${BOOK}/${path}`)).json()) as { key_points: { text: string; band: string } | null };

describe("reference key points", () => {
  test("the first ask starts the writing and answers not ready; the next ask returns the kept points", async () => {
    const c = await owner();
    expect((await keyPoints(c)).key_points).toBeNull();
    await Bun.sleep(50);
    const second = await keyPoints(c);
    expect(second.key_points?.text).toBe("The river runs to the sea.\n• It starts in the mountains.\n• It passes many towns.\n• It ends at the sea.");
    expect(calls).toHaveLength(1);
    await keyPoints(c);
    expect(calls).toHaveLength(1);
  });

  test("an article that is not there stays null and never calls the model", async () => {
    const c = await owner();
    expect((await keyPoints(c, "Missing")).key_points).toBeNull();
    await Bun.sleep(20);
    expect(calls).toHaveLength(0);
  });

  test("Discuss reads the article text for an adult and nothing for a child", async () => {
    const c = await owner();
    await c.post("/api/people", { displayName: "Robin", role: "child", secret: "child-secret" });
    const { db } = await import("@/db"); const { people } = await import("@/db/schema");
    const rows = db.select().from(people).all();
    const adult = rows.find((p) => p.role !== "child")!; const kid = rows.find((p) => p.role === "child")!;
    const id = referenceItemId(BOOK, "River");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    const read = await readReferenceArticle(adult, id);
    expect(read?.title).toContain("River");
    expect(read?.text).toContain("runs from the mountains");
    expect(await readReferenceArticle(kid, id)).toBeNull();
    expect(await readReferenceArticle(adult, "bm90LWEtYm9vaw")).toBeNull();
  });
});
