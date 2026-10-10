// ANSWER-IMG-02 (rules 0, 6, 7, 10; owner decisions 2026-10-06): which
// pictures a subject may get, per age band, against fixture Wikimedia,
// SearXNG and picture hosts. Names are roster-safe or fictional.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests, selectAnswerImages } from "@/lib/answerImages/select";
import { AnswerImagePlacer } from "@/lib/answerImages/turn";
import { answerImageSearch, __resetSearxngEnginesCacheForTests } from "@/lib/packageHost";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fixtureWorld, pictureUrl, type FixtureSubject } from "./answerImagesFixture";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { AnswerImageItem } from "@/wire";

let people: BenchPeople;
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetAnswerImageFetchForTests();
  people = createBenchPeople();
});
afterEach(() => __setAnswerImageDepsForTests(null));

const TOWER: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Tower lead.jpg", files: ["Tower lead.jpg", "Tower night.jpg", "Tower river.jpg"], description: "tower in Paris" };
const ACTOR: FixtureSubject = { id: "Q1001", label: "Vincent Marlow", human: true, birth: "+1971-01-10T00:00:00Z", category: "Vincent Marlow", image: "Marlow 2017.jpg", files: ["Marlow 2017.jpg", "Marlow 2009.jpg", "Marlow stage.jpg"], description: "American actor" };
const YOUNG_STAR: FixtureSubject = { id: "Q1002", label: "Pippa Quill", human: true, birth: `+${new Date().getUTCFullYear() - 14}-03-01T00:00:00Z`, category: "Pippa Quill", image: "Pippa.jpg", files: ["Pippa.jpg"], description: "actor" };
const NO_ARTICLE: FixtureSubject = { id: "Q1003", label: "Willow Rivet", human: true, enwiki: null, image: "Willow.jpg", files: ["Willow.jpg"] };
const KOALA: FixtureSubject = { id: "Q36101", label: "koala", category: "Phascolarctos cinereus", image: "Koala lead.jpg", files: ["Koala lead.jpg"], description: "marsupial" };

function use(subjects: FixtureSubject[], opts: Parameters<typeof fixtureWorld>[1] = {}) {
  const world = fixtureWorld(subjects, opts);
  __setAnswerImageDepsForTests(world.deps);
  return world.log;
}

const srcs = (items: AnswerImageItem[] | undefined) => (items ?? []).map((i) => i.src);

describe("ANSWER-IMG-02: sources per subject and band", () => {
  test("an adult asking about a place gets checked pictures served only by the hub, lead first", async () => {
    use([TOWER]);
    const { set } = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(set?.items.length).toBe(3);
    expect(set?.visible).toBe(3);
    for (const item of set!.items) {
      expect(item.src).toMatch(/^\/api\/answer-image\/ai_[a-f0-9]{32}\?v=tile$/);
      expect(item.full).toMatch(/^\/api\/answer-image\/ai_[a-f0-9]{32}\?v=full$/);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
      expect(item.source.site).toBe("commons.wikimedia.org");
      expect(item.license?.short).toBe("CC BY-SA 4.0");
      expect(item.license?.artist).toBe("Iris");
    }
    expect(set!.items[0]!.caption).toContain("Tower lead");
  });

  test("a person subject never uses SearXNG image search", async () => {
    const log = use([ACTOR], { searchRows: () => [{ title: "look-alike", url: "https://example.com/a", image: pictureUrl(40) }] });
    const { set } = await selectAnswerImages({ subject: "Vincent Marlow", actor: people.owner, band: "adult", roster: [] });
    expect(log.searches).toEqual([]);
    expect(set?.items.length).toBe(3);
    expect(log.pictures).not.toContain(pictureUrl(40));
  });

  test("a living person under 18 yields zero pictures, and nothing is fetched", async () => {
    const log = use([YOUNG_STAR]);
    const result = await selectAnswerImages({ subject: "Pippa Quill", actor: people.owner, band: "adult", roster: [] });
    expect(result.set).toBeNull();
    expect(result.trace.skipped).toBe("minor_subject");
    expect(log.pictures).toEqual([]);
  });

  test("a private person (no Wikipedia article) and an unresolved name yield zero pictures", async () => {
    const log = use([NO_ARTICLE]);
    const privatePerson = await selectAnswerImages({ subject: "Willow Rivet", actor: people.owner, band: "adult", roster: [] });
    expect(privatePerson.set).toBeNull();
    expect(privatePerson.trace.skipped).toBe("no_article");
    const nobody = await selectAnswerImages({ subject: "Nadia Sprout Quillworth", actor: people.owner, band: "adult", roster: [] });
    expect(nobody.set).toBeNull();
    expect(nobody.trace.skipped).toBe("no_article");
    expect(log.pictures).toEqual([]);
  });

  // Owner ruling 11 (2026-10-06, general image search for adults) replaces
  // the coordinator's earlier "no Wikipedia page: no pictures" for adults:
  // an adult asking about a thing gets open-web pictures under the same
  // rules; people, anything the model calls a person, and minors keep the
  // article gate.
  test("an adult's thing with nothing by that name on Wikipedia or Wikidata gets open-web pictures under the same rules", async () => {
    const log = use([], { searchRows: () => [
      { title: "Corner Bakery Daisy storefront", url: "https://www.example.com/corner-bakery-daisy", image: pictureUrl(41), engines: ["bing images"] },
      { title: "bakery", url: "https://example.com/b", image: pictureUrl(42), engines: ["bing images"] },
    ] });
    const result = await selectAnswerImages({ subject: "Corner Bakery Daisy", kind: "bakery", actor: people.owner, band: "adult", roster: [] });
    expect(log.searches).toEqual([{ query: "Corner Bakery Daisy", band: "adult" }]);
    expect(result.set?.items.map((i) => i.source.url)).toEqual(["https://www.example.com/corner-bakery-daisy"]);
    expect(result.trace.resolved_via).toBe("no_article_search");
  });

  // Code review (second pass) on the no-article path: plural and job words
  // name people too; a Wikimedia outage is not "no article"; an exact-name
  // Wikidata item with no English article (it may be a person) is not either.
  test("with no Wikipedia page, a plural or job kind for people gets no pictures and no search", async () => {
    const shop: FixtureSubject = { id: "Q1004", label: "Corner Bakery Daisy", enwiki: null };
    const rows = () => [{ title: "Corner Bakery Daisy storefront", url: "https://www.example.com/corner-bakery-daisy", image: pictureUrl(41), engines: ["bing images"] }];
    for (const kind of ["actors", "footballer", "coworker", "band members", "comedian", "girlfriend", "chef", "classmate"]) {
      const log = use([shop], { searchRows: rows });
      const result = await selectAnswerImages({ subject: "Corner Bakery Daisy", kind, actor: people.owner, band: "adult", roster: [] });
      expect({ kind, set: result.set, searches: log.searches.length }).toEqual({ kind, set: null, searches: 0 });
    }
  });

  test("an exact-name Wikidata item with no English article, or Wikimedia not answering, never opens the web search", async () => {
    const gymnast: FixtureSubject = { id: "Q1005", label: "Juniper Quillfeather", human: true, enwiki: null };
    const log = use([gymnast], { searchRows: () => [{ title: "Juniper Quillfeather", url: "https://www.example.com/juniper-quillfeather", image: pictureUrl(43), engines: ["bing images"] }] });
    const person = await selectAnswerImages({ subject: "Juniper Quillfeather", kind: "gymnast", actor: people.owner, band: "adult", roster: [] });
    expect(person.set).toBeNull();
    expect(log.searches).toEqual([]);
    const world = fixtureWorld([], { searchRows: () => [{ title: "Velvet Lamp", url: "https://www.example.com/velvet-lamp", image: pictureUrl(44), engines: ["bing images"] }] });
    __setAnswerImageDepsForTests({ ...world.deps, fetchJson: async () => { throw new Error("Wikimedia is down"); } });
    const down = await selectAnswerImages({ subject: "Velvet Lamp", kind: "lamp", actor: people.owner, band: "adult", roster: [] });
    expect(down.set).toBeNull();
    expect(down.trace.skipped).toBe("error");
    expect(world.log.searches).toEqual([]);
  });

  test("with no Wikipedia page, a person, a minor's question, or a missing kind still gets no pictures and no search", async () => {
    const shop: FixtureSubject = { id: "Q1004", label: "Corner Bakery Daisy", enwiki: null };
    const rows = () => [{ title: "Corner Bakery Daisy storefront", url: "https://www.example.com/corner-bakery-daisy", image: pictureUrl(41), engines: ["bing images"] }];
    for (const [kind, actor, band] of [["person", people.owner, "adult"], ["actor", people.owner, "adult"], ["bakery", people.child, "teen"], ["", people.owner, "adult"]] as const) {
      const log = use([shop], { searchRows: rows });
      const result = await selectAnswerImages({ subject: "Corner Bakery Daisy", kind, actor, band, roster: [] });
      expect({ kind, band, set: result.set, skipped: result.trace.skipped, searches: log.searches.length }).toEqual({ kind, band, set: null, skipped: "no_article", searches: 0 });
    }
  });

  test("a household member's name never leaves the house as a picture query", async () => {
    const log = use([ACTOR]);
    const result = await selectAnswerImages({ subject: "Bramble", actor: people.owner, band: "adult", roster: ["Bramble"] });
    expect(result.set).toBeNull();
    expect(result.trace.skipped).toBe("household_name");
    expect(log.wikimedia).toEqual([]);
  });

  test("the floor on the subject drops a sensitive subject's pictures before any lookup", async () => {
    const log = use([TOWER]);
    const result = await selectAnswerImages({ subject: "how to make a pipe bomb", actor: people.owner, band: "adult", roster: [] });
    expect(result.set).toBeNull();
    expect(result.trace.skipped).toBe("floor_subject");
    expect(log.wikimedia).toEqual([]);
  });

  test("the floor on captions drops that picture and keeps the rest", async () => {
    const sensitive: FixtureSubject = { ...TOWER, files: ["Tower lead.jpg", "how to make a pipe bomb.jpg", "Tower river.jpg"] };
    use([sensitive]);
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.dropped_by_floor).toBe(1);
    expect(result.set?.items.length).toBe(2);
    expect(result.set!.items.every((i) => !i.caption.includes("bomb"))).toBe(true);
  });

  test("a teen gets Wikimedia pictures only when the article text passes the floor, and never og:image", async () => {
    const log = use([TOWER]);
    const teen = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.child, band: "teen", roster: [] });
    expect(teen.set?.items.length).toBe(3);
    expect(teen.trace.sources).toEqual({ wikimedia: 3, searxng: 0 });
    // The article's intro comes with the subject's own page lookup (study R1).
    expect(log.wikimedia.some((u) => u.includes("en.wikipedia.org/w/api.php") && u.includes("prop=pageprops%7Cextracts"))).toBe(true);
    const bad: FixtureSubject = { ...TOWER, extract: "Here is how to make a pipe bomb, step by step instructions." };
    use([bad]);
    const blocked = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.child, band: "teen", roster: [] });
    expect(blocked.trace.sources?.wikimedia).toBe(0);
    expect(blocked.set).toBeNull();
  });

  test("a child gets image-search pictures only (never Wikimedia), and none of a person", async () => {
    const log = use([KOALA, ACTOR], { searchRows: () => [1, 2, 3].map((n) => ({ title: `koala ${n}`, url: `https://zoo.example/koala-${n}`, image: pictureUrl(50 + n), engines: ["bing images"] })) });
    const koala = await selectAnswerImages({ subject: "koala", actor: people.child, band: "child", roster: [] });
    expect(log.searches).toEqual([{ query: "koala", band: "child" }]);
    expect(koala.trace.sources).toEqual({ wikimedia: 0, searxng: 3 });
    expect(koala.set?.items.every((i) => i.source.site === "zoo.example")).toBe(true);
    const person = await selectAnswerImages({ subject: "Vincent Marlow", actor: people.child, band: "child", roster: [] });
    expect(person.set).toBeNull();
    expect(log.searches.length).toBe(1);
  });

  test("a failed or empty fetch yields no set, never a placeholder", async () => {
    use([TOWER], { failPictures: true });
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(result.set).toBeNull();
    expect(result.trace.skipped).toBe("none_survived");
  });

  test("a lone validated extra is dropped so the badge never reads one; two extras keep a badge of two", async () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => `p${i}.jpg`);
    const six: FixtureSubject = { ...TOWER, files: files(6), image: "p0.jpg" };
    use([six]);
    const r6 = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(r6.set?.items.length).toBe(5);
    expect(r6.set?.visible).toBe(5);
    const seven: FixtureSubject = { ...TOWER, files: files(7), image: "p0.jpg" };
    use([seven]);
    const r7 = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(r7.set?.items.length).toBe(7);
    expect(r7.set?.visible).toBe(5);
    expect(new Set(srcs(r7.set?.items)).size).toBe(7);
  });

  // ANSWER-IMG-05, measured on the real network (2026-10-06): the image
  // search took 1.2 s after the Commons lookup had finished, so a thing's
  // pictures could not fit the turn's budget. Both ask at once now.
  test("the image search asks beside the Commons lookup, not after it", async () => {
    const world = fixtureWorld([KOALA], { searchRows: () => [] });
    let commonsAnswered = false;
    const seen: { searchedBeforeCommonsAnswered: boolean | null } = { searchedBeforeCommonsAnswered: null };
    __setAnswerImageDepsForTests({
      ...world.deps,
      fetchJson: async (url) => {
        if (!url.includes("commons.wikimedia.org")) return world.deps.fetchJson!(url);
        await new Promise((resolve) => setTimeout(resolve, 150));
        commonsAnswered = true;
        return world.deps.fetchJson!(url);
      },
      imageSearch: async (query, actor, band) => {
        seen.searchedBeforeCommonsAnswered ??= !commonsAnswered;
        return world.deps.imageSearch!(query, actor, band);
      },
    });
    await selectAnswerImages({ subject: "koala", actor: people.owner, band: "adult", roster: [] });
    expect(seen.searchedBeforeCommonsAnswered).toBe(true);
  });

  test("the picture fetch ends by the deadline the turn passes in", async () => {
    const world = fixtureWorld([TOWER]);
    const hang = async (_url: string | URL | Request, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("fixture timeout")), { once: true });
    });
    __setAnswerImageDepsForTests({ ...world.deps, fetchOptions: { ...world.deps.fetchOptions, fetch: hang as unknown as typeof fetch } });
    const started = Date.now();
    const { set, trace } = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [], deadlineAt: started + 500 });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(set).toBeNull();
    expect(trace.skipped).toBe("none_survived");
    expect(trace.dropped_by_fetch?.deadline).toBeGreaterThan(0);
  });
});

describe("ANSWER-IMG-02: SearXNG image search per band", () => {
  function fakeSearxng(engines: Array<{ name: string; safesearch: boolean }>) {
    const searches: Array<URL["searchParams"]> = [];
    const server = Bun.serve({ port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/config") return Response.json({ engines: engines.map((e) => ({ ...e, enabled: true, categories: ["images"] })) });
        searches.push(url.searchParams);
        return Response.json({ results: [{ title: "a koala", url: "https://zoo.example/koala", img_src: "https://zoo.example/koala.jpg", thumbnail_src: "https://zoo.example/t.jpg" }, { title: "no picture", url: "https://zoo.example/none" }] });
      },
    });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
    __resetSearxngEnginesCacheForTests();
    return { searches, stop: () => server.stop(true) };
  }

  test("a child gets strict safe search through safe-search-capable engines only", async () => {
    const fake = fakeSearxng([{ name: "bing images", safesearch: true }, { name: "pinterest", safesearch: false }]);
    try {
      const rows = await answerImageSearch("koala", people.child, "child");
      expect(rows).toEqual([{ title: "a koala", url: "https://zoo.example/koala", image: "https://zoo.example/koala.jpg" }]);
      expect(fake.searches[0]!.get("categories")).toBe("images");
      expect(fake.searches[0]!.get("safesearch")).toBe("2");
      expect(fake.searches[0]!.get("engines")).toBe("bing images");
    } finally { fake.stop(); }
  });

  test("a minor gets no image search at all when the instance has no safe-search-capable engine", async () => {
    const fake = fakeSearxng([{ name: "pinterest", safesearch: false }]);
    try {
      expect(await answerImageSearch("koala", people.child, "teen")).toEqual([]);
      expect(fake.searches).toHaveLength(0);
    } finally { fake.stop(); }
  });

  test("an adult searches every engine at their own level", async () => {
    const fake = fakeSearxng([{ name: "pinterest", safesearch: false }]);
    try {
      await answerImageSearch("koala", people.owner, "adult");
      expect(fake.searches[0]!.get("engines")).toBeNull();
    } finally { fake.stop(); }
  });
});

describe("ANSWER-IMG-02 and GENUI-05: the picture gallery is placed at a paragraph boundary, never above released text", () => {
  // The gallery is an ordinary `image_gallery` block event; the one placer treats it like any ready block.
  const gallery = () => ({ t: "block" as const, call_id: "call-img", block: { id: "blk-gallery1", kind: "image_gallery" } });
  const stateWith = (ready: boolean) => ({ toolEvents: ready ? [gallery()] : [] }) as unknown as TurnState;
  const stampOf = (state: TurnState) => (state.toolEvents[0] as { block: { after_paragraph?: number } } | undefined)?.block.after_paragraph;

  test("ready before any text: the gallery leads", () => {
    const state = stateWith(true);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("The tower ");
    expect(stampOf(state)).toBe(0);
    expect(state.placedBlocks?.map((p) => p.offset)).toEqual([0]);
    expect(out.join("")).toBe("The tower ");
  });

  test("ready mid-paragraph: placed at the next break, the piece split there and nothing altered", () => {
    const state = stateWith(false);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("First para");
    state.toolEvents.push(gallery());
    placer.push("graph ends.");
    expect(state.placedBlocks).toBeUndefined();
    placer.push(" Done.\n\nSecond");
    placer.push(" paragraph.");
    expect(out.join("")).toBe("First paragraph ends. Done.\n\nSecond paragraph.");
    expect(stampOf(state)).toBe(1);
    expect(out.join("").slice(0, state.placedBlocks![0]!.offset)).toBe("First paragraph ends. Done.\n\n");
  });

  test("a blank line inside a code block is not a boundary: the gallery waits for the block to close", () => {
    const state = stateWith(false);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("Code:\n\n```\na = 1\n");
    state.toolEvents.push(gallery());
    placer.push("\nb = 2\n```\n\nAfter.");
    expect(out.join("").slice(0, state.placedBlocks![0]!.offset)).toBe("Code:\n\n```\na = 1\n\nb = 2\n```\n\n");
    expect(out.join("")).toBe("Code:\n\n```\na = 1\n\nb = 2\n```\n\nAfter.");
  });

  test("no gallery ready: nothing is placed and the text passes through untouched", () => {
    const state = stateWith(false);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("One.\n\nTwo.");
    expect(state.placedBlocks).toBeUndefined();
    expect(out).toEqual(["One.\n\nTwo."]);
  });
});
