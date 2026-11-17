// CONTENT-POLICY-05 item 14 through the real route: Key points of a reference article are kept per projection, so a reader whose dials
// differ from their own age group's never reads the plain row and never writes to it, and the prompt carries that reader's own dials.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { __resetSidecarsForTests, registerSidecar } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { __resetReferenceReaderCachesForTests } from "@/lib/retrieval/referenceReader";
import { __setReferenceKeyPointsModelForTests } from "@/lib/reference/keyPoints";
import { startFakeKiwix, type FakeKiwix } from "./support/fakeKiwix";
import type { PersonRow } from "@/types";

const BOOK = "wikipedia_en_simple_all_maxi_2026-09";
const words = "The river runs from the mountains to the sea and passes through many towns on its way. ".repeat(6);
const page = (title: string) => `<div class="mw-parser-output"><h1>${title}</h1><p>${words}</p><h2>History</h2><p>${words}</p></div>`;
let kiwix: FakeKiwix | null = null;
const prompts: string[] = [];
const reply = JSON.stringify({ intro: "The river runs to the sea.", points: ["It starts in the mountains.", "It passes many towns.", "It ends at the sea."] });

beforeEach(() => {
  resetDb(); __resetSidecarsForTests(); __resetReferenceReaderCachesForTests(); prompts.length = 0;
  __setReferenceKeyPointsModelForTests((async (messages: Array<{ content: string }>) => { prompts.push(messages[0]!.content); return { ok: true, text: reply }; }) as never);
  kiwix = startFakeKiwix([{ id: BOOK, date: "2026-09-01", articles: { River: { title: "River", html: page("River") }, Lake: { title: "Lake", html: page("Lake") } } }]);
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["true"], port: Number(new URL(kiwix.baseUrl).port) });
});
afterEach(() => { kiwix?.stop(); kiwix = null; __resetSidecarsForTests(); __setReferenceKeyPointsModelForTests(null); });

const ask = async (c: TestClient, path: string) => (await (await c.post(`/api/reference/key-points/${BOOK}/${path}`)).json()) as { key_points: { text: string } | null };

test("a lowered adult never reads the plain adult entry, writes their own, and each article has its own entry", async () => {
  const c = new TestClient();
  await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  expect((await ask(c, "River")).key_points).toBeNull();
  await Bun.sleep(50);
  expect((await ask(c, "River")).key_points?.text).toContain("The river runs to the sea.");
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('"profanity":"unrestricted"');

  expect(setValue(sage, `person:${sage.id}`, "content.own_ceiling", "PG").ok).toBe(true);
  expect((await ask(c, "River")).key_points).toBeNull(); // the plain adult entry is not served to a reader held to PG
  await Bun.sleep(50);
  expect((await ask(c, "River")).key_points?.text).toContain("The river runs to the sea.");
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('"profanity":"mild"');
  expect(prompts[1]).toContain('"band":"adult"');

  expect((await ask(c, "Lake")).key_points).toBeNull(); // another article: its own entry
  await Bun.sleep(50);
  expect(prompts).toHaveLength(3);

  expect(setValue(sage, `person:${sage.id}`, "content.own_ceiling", "default").ok).toBe(true);
  expect((await ask(c, "River")).key_points?.text).toContain("The river runs to the sea."); // back on the plain entry, no new model call
  expect(prompts).toHaveLength(3);
});
