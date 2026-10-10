// IMG-QUALITY-01b: "show me more" returns pictures the conversation has not shown. The shown set is read from the
// conversation's stored `image_gallery` blocks (each item's `id` and `source.url`), nothing new is stored; candidates
// whose source address was shown are dropped before the fetch, fetched pictures whose `ai_` id was shown are dropped
// after decode, fewer than two new pictures means no gallery, and the counter is a count only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests, selectAnswerImages } from "@/lib/answerImages/select";
import { galleryBlockFor } from "@/lib/answerImages/gallery";
import { appendTemporaryTurn, discardTemporarySessions, logTurn, resolveOrCreateConversation, shownPicturesIn } from "@/lib/conversationHistory";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fixtureWorld, pictureUrl, type FixtureSubject } from "./answerImagesFixture";
import type { AnswerImageSet, TurnValue } from "@/wire";

let people: BenchPeople;
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetAnswerImageFetchForTests();
  people = createBenchPeople();
});
afterEach(() => __setAnswerImageDepsForTests(null));

const FILES = ["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg"];
const TOWER: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "p0.jpg", files: FILES, description: "tower in Paris" };
const pageOf = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;
const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

function use(subject: FixtureSubject) {
  const world = fixtureWorld([subject]);
  __setAnswerImageDepsForTests(world.deps);
  return world.log;
}
const ask = (shown?: { ids?: string[]; sources?: string[] }) =>
  selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [], ...(shown ? { shown: { ids: new Set(shown.ids ?? []), sources: new Set(shown.sources ?? []) } } : {}) });

describe("IMG-QUALITY-01b: exclusion by source address, before the fetch", () => {
  test("a candidate whose source address was already shown is never fetched, and is counted", async () => {
    const log = use(TOWER);
    const { set, trace } = await ask({ sources: [pageOf("p1.jpg"), pageOf("p2.jpg")] });
    expect(trace.excluded_already_shown).toBe(2);
    expect(set?.items.length).toBe(4);
    expect(set!.items.some((i) => i.source.url === pageOf("p1.jpg"))).toBe(false);
    // The first six files serve seeds 2..7 in order; p1 and p2 are seeds 3 and 4.
    expect(log.pictures).not.toContain(pictureUrl(3));
    expect(log.pictures).not.toContain(pictureUrl(4));
    expect(log.pictures).toContain(pictureUrl(2));
  });

  test("with nothing shown, nothing is excluded and the counter is absent", async () => {
    use(TOWER);
    const { set, trace } = await ask();
    expect(trace.excluded_already_shown).toBeUndefined();
    expect(set?.items.length).toBe(5);
  });

  test("fewer than two new pictures means no gallery (the answer stays whole)", async () => {
    use(TOWER);
    const { set, trace } = await ask({ sources: FILES.slice(1).map(pageOf) });
    expect(set).toBeNull();
    expect(trace.skipped).toBe("none_survived");
    expect(trace.excluded_already_shown).toBe(5);
  });
});

describe("IMG-QUALITY-01b: exclusion by picture id, after decode (the same bytes under a new address)", () => {
  test("a different address that resolves to a shown ai_ id is dropped and counted", async () => {
    use(TOWER);
    const first = await ask();
    const firstIds = first.set!.items.map((i) => i.id);
    __resetAnswerImageFetchForTests();
    const { set, trace } = await ask({ ids: firstIds.slice(0, 3) });
    expect(trace.excluded_already_shown).toBe(3);
    // The first call showed five of the six files; the sixth was never shown and joins the two unshown ones.
    expect(set?.items.length).toBe(3);
    for (const id of firstIds.slice(0, 3)) expect(set!.items.map((i) => i.id)).not.toContain(id);
  });
});

describe("IMG-QUALITY-01b: the shown set is read from the stored gallery blocks", () => {
  const item = (id: string, url: string): AnswerImageSet["items"][number] => ({ id, src: `/api/answer-image/${id}?v=tile`, full: `/api/answer-image/${id}?v=full`, width: 640, height: 480, alt: "a tower", caption: "a tower", source: { title: "t", site: "commons.wikimedia.org", url } });
  const shownBlock = () => galleryBlockFor({ visible: 2, items: [item(`ai_${"a".repeat(32)}`, pageOf("p0.jpg")), item(`ai_${"b".repeat(32)}`, pageOf("p1.jpg"))] }, "Eiffel Tower", "test", "1:0:test") as unknown as NonNullable<TurnValue["blocks"]>[number];

  test("a saved conversation: ids and source addresses come from its stored image_gallery blocks", () => {
    const conversation = resolveOrCreateConversation(people.owner, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    logTurn(people.owner, "chat", "show me the Eiffel Tower", { turn_id: "t-shown-1", conversation_id: conversation.value.id, reply: { text: "Here." }, source: "model", safety: SAFE, blocks: [shownBlock()] }, {});
    const shown = shownPicturesIn(conversation.value.id);
    expect([...shown.ids].sort()).toEqual([`ai_${"a".repeat(32)}`, `ai_${"b".repeat(32)}`]);
    expect([...shown.sources].sort()).toEqual([pageOf("p0.jpg"), pageOf("p1.jpg")]);
    expect(shownPicturesIn("no-such-conversation").ids.size).toBe(0);
  });

  test("a temporary chat reads the same from its in-window turns, and the exclusion works", async () => {
    const temporary = resolveOrCreateConversation(people.owner, "chat", undefined, { temporary: true });
    if (!temporary.ok) throw new Error(temporary.error);
    appendTemporaryTurn(people.owner, "chat", "show me the Eiffel Tower", { turn_id: "t-shown-temp", conversation_id: temporary.value.id, reply: { text: "Here." }, source: "model", safety: SAFE, blocks: [shownBlock()] }, {});
    const shown = shownPicturesIn(temporary.value.id);
    expect(shown.sources.has(pageOf("p0.jpg"))).toBe(true);
    expect(shown.ids.size).toBe(2);
    const log = use(TOWER);
    const { set, trace } = await ask({ ids: [...shown.ids], sources: [...shown.sources] });
    expect(trace.excluded_already_shown).toBe(2);
    expect(set!.items.some((i) => i.source.url === pageOf("p0.jpg"))).toBe(false);
    expect(log.pictures).not.toContain(pictureUrl(2));
    discardTemporarySessions(people.owner.id);
  });
});
