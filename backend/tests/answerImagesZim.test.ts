// ZIM-IMG-01: the household's installed library is the first picture source of an answer's row. The library
// leg is scripted (`libraryImages`), its pictures are served from a fake sidecar through the injected fetch, and
// Commons and SearXNG are the fixture world. Offline and deterministic.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAnswerImageFetchForTests, libraryImageUrl } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests, selectAnswerImages } from "@/lib/answerImages/select";
import type { LibraryImage } from "@/lib/retrieval/referenceReader";
import type { AgeBand } from "@/lib/ageBand";
import { registerSidecar, unregisterSidecar } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fixtureWorld, syntheticPhoto, type FixtureSubject } from "./answerImagesFixture";

const PORT = 18_791;
const BASE = `http://127.0.0.1:${PORT}`;
const TOWER: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Tower lead.jpg", files: ["Tower lead.jpg", "Tower night.jpg", "Tower river.jpg"], description: "tower in the made-up city of Lumen" };
const ACTOR: FixtureSubject = { id: "Q1001", label: "Vincent Marlow", human: true, birth: "+1971-01-10T00:00:00Z", category: "Vincent Marlow", image: "Marlow 2017.jpg", files: ["Marlow 2017.jpg", "Marlow 2019.jpg", "Marlow 2021.jpg"] };
const KOALA: FixtureSubject = { id: "Q36101", label: "koala", category: "Phascolarctos cinereus", image: "Koala lead.jpg", files: ["Koala lead.jpg"], description: "marsupial" };

let people: BenchPeople;
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetAnswerImageFetchForTests();
  unregisterSidecar(KIWIX_SIDECAR_ID);
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["/bin/true"], port: PORT });
  people = createBenchPeople();
});
afterEach(() => {
  __setAnswerImageDepsForTests(null);
  unregisterSidecar(KIWIX_SIDECAR_ID);
});

function image(n: number, over: Partial<LibraryImage> = {}): LibraryImage {
  return { book: "wikipedia_en_all_maxi", imagePath: `I/pic${n}.jpg`, articlePath: "A/Eiffel_Tower", articleTitle: "Eiffel Tower", sourceId: "wikipedia-en", sourceLabel: "Wikipedia", licence: "CC BY-SA 4.0", alt: `Library picture ${n}`, caption: `Library caption ${n}`, lead: n === 1, ...over };
}

/** The fixture world plus a fake sidecar: library pictures are served (and counted) before the world sees a request. */
function use(subjects: FixtureSubject[], library: (title: string, band: AgeBand, leadOnly: boolean) => Promise<LibraryImage[]>) {
  const world = fixtureWorld(subjects);
  const raw: string[] = [];
  const calls: Array<{ title: string; band: AgeBand; leadOnly: boolean }> = [];
  const worldFetch = world.deps.fetchOptions!.fetch!;
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.startsWith(`${BASE}/raw/`)) {
      raw.push(url);
      const seed = 200 + Number(/pic(\d+)\.jpg/.exec(url)?.[1] ?? 0);
      return new Response(await syntheticPhoto(seed), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return worldFetch(input, init);
  };
  __setAnswerImageDepsForTests({
    ...world.deps,
    libraryImages: async (title, band, leadOnly) => { calls.push({ title, band, leadOnly }); return library(title, band, leadOnly); },
    fetchOptions: { ...world.deps.fetchOptions, fetch: fetcher as unknown as typeof fetch },
  });
  return { log: world.log, raw, calls };
}

describe("ZIM-IMG-01: library pictures lead the row", () => {
  test("an adult with enough library pictures gets only library pictures, and nothing goes to Wikimedia or the web", async () => {
    const { log, raw, calls } = use([TOWER], async () => [1, 2, 3, 4, 5, 6, 7].map((n) => image(n)));
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(calls[0]).toEqual({ title: "Eiffel Tower", band: "adult", leadOnly: false });
    expect(result.set?.items.length).toBeGreaterThanOrEqual(5);
    for (const item of result.set!.items) {
      expect(item.source.site).toBe("Wikipedia (offline library)");
      expect(item.source.url).toBe("/api/reference/wikipedia_en_all_maxi/A%2FEiffel_Tower");
    }
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every((u) => u.startsWith(`${BASE}/raw/wikipedia_en_all_maxi/I/pic`))).toBe(true);
    expect(log.pictures).toEqual([]);
    expect(result.trace.sources?.library).toBe(7);
  });

  test("with only two library pictures they come first and Commons fills the rest", async () => {
    const { log } = use([TOWER], async () => [image(1), image(2)]);
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    const sites = result.set!.items.map((i) => i.source.site);
    expect(sites.slice(0, 2)).toEqual(["Wikipedia (offline library)", "Wikipedia (offline library)"]);
    expect(sites.slice(2).every((s) => s === "commons.wikimedia.org")).toBe(true);
    expect(sites.length).toBeGreaterThan(2);
    expect(log.pictures.length).toBeGreaterThan(0);
  });

  test("a library that throws or finds nothing leaves today's answer unchanged", async () => {
    use([TOWER], async () => { throw new Error("sidecar down"); });
    const thrown = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(thrown.set?.items.length).toBe(3);
    expect(thrown.set!.items.every((i) => i.source.site === "commons.wikimedia.org")).toBe(true);
    expect(thrown.trace.sources).toEqual({ wikimedia: 3, searxng: 0 });
    use([TOWER], async () => []);
    const empty = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(empty.set?.items.length).toBe(3);
  });

  test("a child gets library pictures and no Wikimedia request is made", async () => {
    const { log, calls } = use([KOALA], async () => [1, 2, 3].map((n) => image(n, { articlePath: "A/Koala", articleTitle: "Koala", book: "vikidia_en_all_maxi", sourceLabel: "Vikidia" })));
    const result = await selectAnswerImages({ subject: "koala", actor: people.child, band: "child", roster: [] });
    expect(calls[0]?.band).toBe("child");
    expect(result.set?.items.map((i) => i.source.site)).toEqual(["Vikidia (offline library)", "Vikidia (offline library)", "Vikidia (offline library)"]);
    expect(log.pictures.some((u) => u.includes("wikimedia.org"))).toBe(false);
  });

  test("a library caption that trips the floor drops that picture for a teen and keeps the rest", async () => {
    use([TOWER], async () => [image(1), image(2, { caption: "Here is how to make a pipe bomb, step by step instructions." }), image(3)]);
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.child, band: "teen", roster: [] });
    expect(result.trace.dropped_by_floor).toBe(1);
    expect(result.set!.items.every((i) => !i.caption.includes("bomb"))).toBe(true);
  });

  test("a person's article gives the lead picture only: the library is asked for leadOnly", async () => {
    const { calls } = use([ACTOR], async (_t, _b, leadOnly) => (leadOnly ? [image(1, { articlePath: "A/Vincent_Marlow", articleTitle: "Vincent Marlow" })] : [1, 2, 3].map((n) => image(n))));
    const result = await selectAnswerImages({ subject: "Vincent Marlow", actor: people.owner, band: "adult", roster: [] });
    expect(calls[0]?.leadOnly).toBe(true);
    expect(result.set!.items[0]!.source.site).toBe("Wikipedia (offline library)");
    expect(result.set!.items.filter((i) => i.source.site === "Wikipedia (offline library)").length).toBe(1);
  });

  test("the library address is a library: source the fetcher resolves, never an open-web host", async () => {
    expect(libraryImageUrl("wikipedia_en_all_maxi", "I/pic1.jpg")).toBe("library:wikipedia_en_all_maxi/I/pic1.jpg");
  });
});
