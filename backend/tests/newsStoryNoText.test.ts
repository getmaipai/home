// A story whose page cannot be read and whose feed gave no summary still opens: its headline and a plain note, never
// "This story is not available". Saving such a story keeps it on the hub so its Saved row opens later.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { __setPageFetchForTests } from "@/lib/packageHost";
import { __resetNewsArticleForTests, __setPaceWaitForTests } from "@/lib/news/article";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { TestClient } from "./client";
import { owner } from "./support/testAuth";
import { ADULT_HOST, installNewsApp, putItem, removeNewsApp, resetNewsState, seedFeeds } from "./support/newsFixture";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); resetNewsState(); __resetNewsArticleForTests(); __setPaceWaitForTests(async () => {}); });
afterEach(() => { __setPageFetchForTests(null); __setPaceWaitForTests(null); removeNewsApp(); });

const unreadable = (async () => { throw new HostError("network_unreachable", "none"); }) as unknown as (url: string) => Promise<never>;

async function open(client: TestClient, id: string) {
  const response = await client.post("/api/plugins/news/data/story", { id });
  return { status: response.status, json: (await response.json()) as { blocks?: Array<{ props: { blocks: Array<{ type: string; text?: string }> } }> } };
}

test("an unreadable page with no summary opens with a note, not a 404", async () => {
  installNewsApp();
  const { client } = await owner();
  __setPageFetchForTests(unreadable);
  const item = putItem(seedFeeds().household, ADULT_HOST, { title: "No text story", summary: "", ageHours: 1 });
  const { status, json } = await open(client, item.id);
  expect(status).toBe(200);
  const blocks = json.blocks?.[0]?.props.blocks ?? [];
  expect(blocks.some((block) => block.type === "note" && /did not load/.test(block.text ?? ""))).toBe(true);
});

test("saving a story whose text could not be fetched pins what is stored, so the shelf prune keeps it", async () => {
  installNewsApp();
  const { client } = await owner();
  __setPageFetchForTests(unreadable);
  const item = putItem(seedFeeds().household, ADULT_HOST, { title: "Kept story", summary: "A short summary the feed gave.", ageHours: 1 });
  const saved = await client.post("/api/plugins/news/actions/save", { item_id: item.id, on: true });
  expect(saved.status).toBe(200);
  const stored = sharedShelfStore()!.getContent(item.id, "adult");
  expect(stored?.pinned).toBe(true);
  expect(stored?.source).toBe("teaser");
});
