// The "more from this topic" list under an article must not arrive before the article: asked alone it is instant, so the page showed a
// channel-like list for the moment before the story loaded.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { __setPageFetchForTests } from "@/lib/packageHost";
import { __resetNewsArticleForTests, __setPaceWaitForTests } from "@/lib/news/article";
import { TestClient } from "./client";
import { owner } from "./support/testAuth";
import { ADULT_HOST, installNewsApp, putItem, removeNewsApp, resetNewsState, seedFeeds } from "./support/newsFixture";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); resetNewsState(); __resetNewsArticleForTests(); __setPaceWaitForTests(async () => {}); });
afterEach(() => { __setPageFetchForTests(null); __setPaceWaitForTests(null); removeNewsApp(); });

test("the more list waits for the story's page fetch", async () => {
  installNewsApp();
  const { client } = await owner();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  __setPageFetchForTests((async () => { await gate; throw new HostError("network_unreachable", "none"); }) as unknown as (url: string) => Promise<never>);
  const item = putItem(seedFeeds().household, ADULT_HOST, { title: "Slow story", summary: "A short summary.", ageHours: 1 });
  let answered = false;
  const more = (client as TestClient).post("/api/plugins/news/data/more", { id: item.id }).then((response) => { answered = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(answered).toBe(false);
  release();
  expect((await more).status).toBe(200);
});
