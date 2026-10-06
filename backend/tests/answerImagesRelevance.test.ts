// ANSWER-IMG-05b: the picture row is of the subject and is not a row of
// private people's snapshots. The inputs are the exact titles, descriptions
// and hosts the real pipeline showed in ANSWER-IMG-05's bench (2026-10-06,
// data-scratch/chat-ab/img05-run3), each tile opened and judged by eye.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests, selectAnswerImages } from "@/lib/answerImages/select";
import { judgeRelevance, namesSubject, subjectNames, type RelevanceContext, type RelevanceInput } from "@/lib/answerImages/relevance";
import { filterAnswerImages } from "@/lib/answerImages/quality";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fixtureWorld, pictureUrl, syntheticPhoto, type FixtureSubject } from "./answerImagesFixture";

type Extra = Partial<Pick<RelevanceInput, "objectName" | "categories" | "restrictions" | "width" | "format" | "nonPhoto" | "lead">>;
const commons = (title: string, description = "", extra: Extra = {}): RelevanceInput => ({ source: "wikimedia", lead: false, title, description, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`, image: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title)}.jpg/1280px-x.jpg`, ...extra });
const search = (title: string, page: string, image: string, extra: Extra = {}): RelevanceInput => ({ source: "search", lead: false, title, description: "", page, image, ...extra });
const thing = (names: string[], commonsCategory?: string, band: RelevanceContext["band"] = "adult"): RelevanceContext => ({ names: subjectNames(names), subjectIsPerson: false, band, ...(commonsCategory ? { commonsCategory } : {}) });
const person = (names: string[], commonsCategory?: string, band: RelevanceContext["band"] = "adult"): RelevanceContext => ({ ...thing(names, commonsCategory, band), subjectIsPerson: true });

// The exact Commons rows (title, description, visible categories,
// Restrictions, width) read live on 2026-10-06 for the ANSWER-IMG-05 sets.
describe("IMGQ-04: a picture is of its subject (two signals agree)", () => {
  const blaine = person(["David Blaine"], "David Blaine");

  test("David Blaine's 'Davidblaine03102003' (London City Hall, in his category, no description) has one signal and is dropped", () => {
    expect(judgeRelevance(commons("Davidblaine03102003", "", { categories: ["City Hall, London (Southwark)", "David Blaine"], width: 800 }), blaine)).toBe("one_signal");
  });

  test("captioned photos of him in his category stay", () => {
    expect(judgeRelevance(commons("David.Blaine", "David Blaine performing his \"Drowned Alive\" stunt at the Lincoln Center", { categories: ["David Blaine", "Diving helmets"] }), blaine)).toBeNull();
    expect(judgeRelevance(commons("Donald Trump announcing latest David Blaine feat 5", "Donald Trump at a press conference with David Blaine announcing Blaine's latest feat, The Upside Down Man , in New York City at the Trump Tower.", { categories: ["David Blaine", "Donald Trump at Trump Tower (Manhattan)"] }), blaine)).toBeNull();
  });

  test("the lead image needs no second signal, but a lead that is a stated 32 px icon is still dropped", () => {
    expect(judgeRelevance(commons("Davidblaine03102003", "", { lead: true }), blaine)).toBeNull();
    expect(judgeRelevance(commons("Farm-Fresh emotion david blaine", "\"Farm-Fresh Web Icons\" - Updated 2014", { categories: ["David Blaine", "Farm-Fresh emoticons"], width: 32 }), blaine)).toBe("api_size");
  });

  test("a Commons title in another language's label, a plural and a glued number name the subject", () => {
    const tower = thing(["Eiffel Tower", "Tour Eiffel", "Eiffelturm"], "Eiffel Tower");
    expect(judgeRelevance(commons("La tour Eiffel en 2026 49", "La tour Eiffel en 2026", { categories: ["Eiffel Tower"] }), tower)).toBeNull();
    const panda = subjectNames(["red panda", "Ailurus fulgens"]);
    expect(namesSubject("3 red pandas play-fighting", panda)).toBe(true);
    expect(namesSubject("RedPanda SingalilaNationalPark DFrame", panda)).toBe(true);
    expect(namesSubject("Red Panda7", panda)).toBe(true);
    expect(namesSubject("любимое животное автора страницы", panda)).toBe(false);
  });

  test("the koala category's park and theme-park shots and the anatomy plate have one signal and are dropped", () => {
    const koala = thing(["koala", "koala", "Phascolarctos cinereus"], "Phascolarctos cinereus");
    expect(judgeRelevance(commons("Black Hill Conservation Park on 27 June 2025 06", "Black Hill Conservation Park on 27 June 2025.", { categories: ["Black Hill Conservation Park", "Phascolarctos cinereus"] }), koala)).toBe("one_signal");
    expect(judgeRelevance(commons("Black Hill Conservation Park on 27 June 2025 06", "Black Hill Conservation Park on 27 June 2025.", { categories: ["Black Hill Conservation Park", "Marsupials"] }), koala)).toBe("no_subject_match");
    expect(judgeRelevance(commons("Genera mammalium (6260185563)", "GENERA MAMMALIUM MARSUPIALIA. Lám. XI. 5 A. Cabrera pinx. PHALANGERID/E", { categories: ["Genera mammalium (1919)", "Marsupialia skulls"] }), koala)).toBe("no_subject_match");
    expect(judgeRelevance(commons("Koala (Phascolarctos cinereus) female with joey Kangaroo Island", "Koala ( Phascolarctos cinereus ) female with joey Kangaroo Island, South Australia", { categories: ["Mammals of South Australia", "Phascolarctos cinereus"] }), koala)).toBeNull();
  });

  test("a short alias never matches on its own", () => {
    expect(subjectNames(["David Blaine"], ["DB"])).toEqual(["david blaine"]);
  });

  // Code review findings on ANSWER-IMG-05b (2026-10-06), each with the
  // reviewer's exact inputs.
  test("a camelCase name matches its lowercase spellings ('PlayStation 5' in '/playstation-5-review')", () => {
    const ps5 = thing(["PlayStation 5"]);
    expect(judgeRelevance(search("Sony Playstation 5 console review", "https://www.theverge.com/playstation-5-review", "https://cdn.example.com/ps5.jpg"), ps5)).toBeNull();
  });

  test("a short subject name like 'BMW' still names its pictures", () => {
    const bmw = thing(["BMW"], "BMW");
    expect(judgeRelevance(commons("BMW 3 Series 2020", "", { categories: ["BMW"] }), bmw)).toBeNull();
  });

  test("the lead image is never judged by the English caption lists ('Der Eiffelturm, wie man ihn vom Trocadero sieht')", () => {
    const tower = thing(["Eiffel Tower"], "Eiffel Tower");
    expect(judgeRelevance(commons("Tour Eiffel Trocadero", "Der Eiffelturm, wie man ihn vom Trocadero sieht", { lead: true }), tower)).toBeNull();
    expect(judgeRelevance(commons("Eiffelturm Trocadero", "Der Eiffelturm, wie man ihn vom Trocadero sieht", { categories: ["Eiffel Tower"] }), { ...tower, names: subjectNames(["Eiffel Tower"], ["Eiffelturm"]) })).toBeNull();
  });

  test("another language's label names a Commons file but never an open-web row ('Tiburón' for Jaws)", () => {
    const jaws: RelevanceContext = { names: subjectNames(["Jaws"], ["Tiburón", "Lo squalo"]), searchNames: subjectNames(["Jaws"]), subjectIsPerson: false, band: "adult", commonsCategory: "Jaws (film)" };
    expect(judgeRelevance(search("Tiburón blanco", "https://example.com/tiburon-blanco/", "https://example.com/tiburon-blanco.jpg"), jaws)).toBe("no_subject_match");
    expect(judgeRelevance(commons("Tiburón (película) cartel", "", { categories: ["Jaws (film)"] }), jaws)).toBeNull();
  });
});

describe("IMGQ-04: a thing's row is not private people's snapshots", () => {
  const sw = thing(["Nintendo Switch"], "Nintendo Switch");
  const st = thing(["Stranger Things"]);

  test("the Nintendo Switch category's cosplayers, market crowd and a YouTuber are dropped by their own Commons fields; the console stays", () => {
    expect(judgeRelevance(commons("Cosplayers of Eromanga Sensei at Rainbow Gala 27 - D2T1410", "Cosplayers of Izumi Sagiri from Eromanga Sensei at Rainbow Gala 27", { restrictions: ["costume"], categories: ["2 cosplayers", "Cosplay at Rainbow Gala 27", "Nintendo Switch"] }), sw)).toBe("restriction");
    expect(judgeRelevance(commons("Comic Market 97 Day 4 Cosplayers (49566324407)", "コミックマーケット97 4日目 コスプレイヤー", { categories: ["Cosplay at Comic Market 97", "Nintendo Switch", "Unidentified cosplay at Comic Market"] }), sw)).toBe("category:cosplay");
    expect(judgeRelevance(commons("Area D, Bahamut Market 20180707", "2018巴哈市集D區。", { categories: ["Bahamut Market 2018", "Nintendo Switch"] }), sw)).toBe("one_signal");
    expect(judgeRelevance(commons("Children0704", "中天綜合台《大學生了沒》成員邱志恒。", { categories: ["1994 births", "Male YouTubers from Taiwan", "Nintendo Switch"] }), sw)).toBe("caption:children");
    expect(judgeRelevance(commons("Child plays video game on Nintendo Switch while sitting on a couch", "A child is focused on playing a video game on a Nintendo Switch.", { categories: ["Nintendo Switch", "Nintendo Switch 2"] }), sw)).toBe("caption:child");
    expect(judgeRelevance(commons("Comparison of Nintendo Switch, Nintendo Switch OLED, and Steam Deck", "Comparison of Nintendo Switch, Nintendo Switch OLED, and Steam Deck in size", { categories: ["Nintendo Switch", "Steam Deck (LCD)"] }), sw)).toBeNull();
  });

  test("a personality-rights file is left out of a thing's row, kept for an adult's person subject, left out for a teen when filed with a crowd", () => {
    const portrait = commons("David Blaine by David Shankbone", "David Blaine at the premiere of Redbelt at the 2008 Tribeca Film Festival .", { restrictions: ["personality"], categories: ["2008 Tribeca Film Festival", "David Blaine"] });
    expect(judgeRelevance(portrait, person(["David Blaine"], "David Blaine"))).toBeNull();
    expect(judgeRelevance({ ...portrait, title: "Nintendo Switch launch", description: "Nintendo Switch launch day" }, sw)).toBe("personality_rights");
    expect(judgeRelevance({ ...portrait, categories: ["David Blaine", "Crowds in New York City"] }, person(["David Blaine"], "David Blaine", "teen"))).toBe("personality_rights");
  });

  test("Stranger Things: a Flickr fan build is a personal host; a row naming it once is one signal; a page naming it in title and address stays", () => {
    expect(judgeRelevance(search("LEGO® TBB Stranger Things Contest: Hawkins Lab", "https://www.flickr.com/photos/someone/5123456789", "https://live.staticflickr.com/65535/5123456789_abc.jpg"), st)).toBe("personal_host");
    expect(judgeRelevance(search("Eleven - Stranger Things", "https://example.com/gallery/8812", "https://cdn.example.com/i/8812.jpg"), st)).toBe("one_signal");
    expect(judgeRelevance(search("Stranger Things' Upside Down Timeline & Origin Explained", "https://screenrant.com/stranger-things-upside-down-timeline-origin-explained/", "https://static1.srcdn.com/wordpress/wp-content/uploads/2022/upside-down.jpg"), st)).toBeNull();
    expect(judgeRelevance(search("Stranger Things key art", "https://www.shutterstock.com/stranger-things-123", "https://image.shutterstock.com/stranger-things.jpg"), st)).toBe("stock_preview");
  });

  test("the subject's official site agrees: its own picture with the name in the title is kept", () => {
    const ctx = { ...sw, officialSite: "http://www.nintendo.com/switch/" };
    expect(judgeRelevance(search("Nintendo Switch system", "https://www.nintendo.com/us/switch/system/", "https://assets.nintendo.com/image/upload/hero.jpg"), ctx)).toBeNull();
  });

  test("a snapshot captioned as someone's own is dropped even when it names the subject", () => {
    const koala = thing(["koala"], "Phascolarctos cinereus");
    expect(judgeRelevance(commons("A healthy koala in Para Wirra after the opening rains of the year", "This friendly Koala my daughter and I found on a road just after a hot South Australian day", { categories: ["Phascolarctos cinereus"] }), koala)).toBe("caption:my");
    expect(judgeRelevance(commons("Me with Nintendo Switch", "", { categories: ["Nintendo Switch"] }), sw)).toBe("caption:me with");
    expect(judgeRelevance(commons("Nintendo Switch selfie", "", { categories: ["Nintendo Switch"] }), sw)).toBe("caption:selfie");
  });

  test("the subject's own name never counts against it", () => {
    expect(judgeRelevance(commons("My Little Pony toys at a shop", "", { categories: ["My Little Pony"] }), thing(["My Little Pony"], "My Little Pony"))).toBeNull();
  });
});

describe("IMGQ-04: kinds that are not photos", () => {
  test("the teen red panda set's desktop screenshot is dropped by its Commons category", () => {
    const panda = thing(["red panda", "Ailurus fulgens"], "Ailurus fulgens", "teen");
    expect(judgeRelevance(commons("Virtual Pet Desktop Red Panda napping on an application window-1BMbzN5MeJw", "a virtual desktop red panda \"sleeps\" on an application window", { categories: ["Ailurus fulgens", "Entertainment software", "Screenshots of software"], width: 1920 }), panda)).toBe("category:screenshots");
    expect(judgeRelevance(commons("Virtual Pet Desktop Red Panda napping on an application window-1BMbzN5MeJw", "a virtual desktop red panda \"sleeps\" on an application window", { categories: ["Ailurus fulgens"] }), panda)).toBe("caption:application window");
  });

  test("a logo Wikidata names, an animated GIF and an SVG are dropped before any fetch", () => {
    const sw = thing(["Nintendo Switch"], "Nintendo Switch");
    expect(judgeRelevance(commons("Nintendo Switch logo", "", { nonPhoto: true, categories: ["Nintendo Switch"] }), sw)).toBe("non_photo_property");
    expect(judgeRelevance(search("Nintendo Switch spin", "https://example.com/nintendo-switch", "https://example.com/nintendo-switch.gif"), sw)).toBe("not_still_raster");
    expect(judgeRelevance(search("Nintendo Switch outline", "https://example.com/nintendo-switch", "https://example.com/i/1", { format: "svg" }), sw)).toBe("not_still_raster");
  });

  test("a PNG at exactly a screen's size is dropped; the same picture as a JPEG photo is kept", async () => {
    const photo = await syntheticPhoto(7, 1920, 1080);
    const png = new Uint8Array(await sharp(photo).png().toBuffer());
    const result = await filterAnswerImages([{ id: "png", bytes: png, contentType: "image/png" }, { id: "jpg", bytes: photo, contentType: "image/jpeg" }]);
    expect(result.dropped_by_quality.screenshot).toBe(1);
    expect(result.images.map((i) => i.id)).toEqual(["jpg"]);
  });
});

describe("IMGQ-04: the pipeline keeps only the subject's pictures", () => {
  let people: BenchPeople;
  beforeEach(() => {
    resetDb();
    __resetRateLimiterForTests();
    __resetAnswerImageFetchForTests();
    people = createBenchPeople();
  });
  afterEach(() => __setAnswerImageDepsForTests(null));

  test("a person's category member with only a file-name title is left out and counted", async () => {
    const magician: FixtureSubject = { id: "Q1010", label: "Vincent Marlow", human: true, birth: "+1973-04-04T00:00:00Z", category: "Vincent Marlow", image: "Vincent Marlow 2008.jpg", files: ["Vincent Marlow 2008.jpg", "Vincentmarlow03102003.jpg", "Vincent Marlow stage.jpg", "Vincent Marlow 2014.jpg"] };
    const world = fixtureWorld([magician]);
    // The fixture Commons describes every file as "<label> photo <file>";
    // this one, like the real file, has no description of its own.
    const fetchJson = world.deps.fetchJson!;
    __setAnswerImageDepsForTests({ ...world.deps, fetchJson: async (url) => {
      const out = await fetchJson(url) as { query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ extmetadata?: Record<string, { value?: unknown }> }> }> } };
      for (const page of Object.values(out.query?.pages ?? {})) if (page.title === "File:Vincentmarlow03102003.jpg") page.imageinfo![0]!.extmetadata!.ImageDescription = { value: "" };
      return out;
    } });
    const result = await selectAnswerImages({ subject: "Vincent Marlow", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.dropped_by_relevance).toEqual({ one_signal: 1 });
    expect(result.set?.items.map((i) => i.caption).some((c) => c.includes("03102003"))).toBe(false);
    expect(result.set?.items.length).toBe(3);
  });

  test("an adult's image-search rows from a personal host or naming the subject once are left out", async () => {
    const show: FixtureSubject = { id: "Q1011", label: "Stranger Things", enwiki: "Stranger Things", description: "television series" };
    use(show, () => [
      { title: "LEGO® TBB Stranger Things Contest: Hawkins Lab", url: "https://www.flickr.com/photos/someone/5123456789", image: pictureUrl(60) },
      { title: "Eleven - Stranger Things", url: "https://example.com/gallery/8812", image: pictureUrl(61) },
      { title: "Stranger Things season 4 key art", url: "https://press.example.com/stranger-things-season-4", image: pictureUrl(62) },
    ]);
    const result = await selectAnswerImages({ subject: "Stranger Things", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.dropped_by_relevance).toEqual({ personal_host: 1, one_signal: 1 });
    expect(result.set?.items.map((i) => i.source.url)).toEqual(["https://press.example.com/stranger-things-season-4"]);
  });

  test("the open web only fills a row: with three good Commons pictures, an adult's search pictures are not used", async () => {
    const tower: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Eiffel Tower lead.jpg", files: ["Eiffel Tower lead.jpg", "Eiffel Tower night.jpg", "Eiffel Tower river.jpg"] };
    use(tower, () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70) }]);
    const full = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(full.trace.search_not_needed).toBe(1);
    expect(full.set?.items.every((i) => i.source.site === "commons.wikimedia.org")).toBe(true);
    const thin: FixtureSubject = { ...tower, files: ["Eiffel Tower lead.jpg", "Eiffel Tower night.jpg"] };
    use(thin, () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70) }]);
    const filled = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(filled.trace.search_not_needed).toBeUndefined();
    expect(filled.set?.items.map((i) => i.source.site)).toEqual(["commons.wikimedia.org", "commons.wikimedia.org", "travel.example.com"]);
  });

  test("with Commons enough to fill the row twice over, the open web's pictures are never fetched", async () => {
    const files = Array.from({ length: 7 }, (_, i) => `Eiffel Tower view ${i + 1}.jpg`);
    const tower: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: files[0], files };
    const world = fixtureWorld([tower], { searchRows: () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70) }] });
    __setAnswerImageDepsForTests(world.deps);
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(world.log.pictures).not.toContain(pictureUrl(70));
    expect(result.trace.search_held_back).toBe(1);
  });

  function use(subject: FixtureSubject, rows: () => { title: string; url: string; image: string }[]) {
    const world = fixtureWorld([subject], { searchRows: rows });
    __setAnswerImageDepsForTests(world.deps);
  }
});
