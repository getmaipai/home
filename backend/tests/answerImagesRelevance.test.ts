// ANSWER-IMG-05b: the picture row is of the subject and is not a row of
// private people's snapshots. The inputs are the exact titles, descriptions
// and hosts the real pipeline showed in ANSWER-IMG-05's bench (2026-10-06,
// data-scratch/chat-ab/img05-run3), each tile opened and judged by eye.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests, mergeDepicts, selectAnswerImages } from "@/lib/answerImages/select";
import { __resetDepictsForTests, depictsUrl, wikimediaDepicts } from "@/lib/answerImages/wikimedia";
import { isWeakEvidence, judgeRelevance, namesSubject, subjectNames, type RelevanceContext, type RelevanceInput } from "@/lib/answerImages/relevance";
import { filterAnswerImages } from "@/lib/answerImages/quality";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { fixtureWorld, pictureUrl, syntheticPhoto, type FixtureSubject } from "./answerImagesFixture";

type Extra = Partial<Pick<RelevanceInput, "objectName" | "categories" | "restrictions" | "width" | "format" | "nonPhoto" | "lead" | "engines" | "depicts">>;
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
    expect(judgeRelevance(search("Sony Playstation 5 console review", "https://www.theverge.com/playstation-5-review", "https://cdn.example.com/ps5.jpg", { engines: ["bing images"] }), ps5)).toBeNull();
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
    expect(judgeRelevance(search("Tiburón blanco", "https://example.com/tiburon-blanco/", "https://example.com/tiburon-blanco.jpg", { engines: ["bing images"] }), jaws)).toBe("below_search_score");
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

  // Image-search accuracy study (2026-10-06): exact rows from its labelled
  // data (data-scratch/research/image-search-study-data/results.json).
  test("Stranger Things: Bing's row naming it is kept; the Flickr, Openverse and Pinterest rows are not", () => {
    expect(judgeRelevance(search("Stranger Things Trailer", "http://www.slashfilm.com/stranger-things-trailer/", "http://www.slashfilm.com/wp/wp-content/images/stranger-things-1.jpg", { engines: ["bing images"] }), st)).toBeNull();
    expect(judgeRelevance(search("LEGO® TBB Stranger Things Contest: Hawkins Lab", "https://www.flickr.com/photos/67167663@N02/48361581366", "https://live.staticflickr.com/65535/48361581366_5ffb8fc0c2_b.jpg", { engines: ["openverse"] }), st)).toBe("personal_host");
    expect(judgeRelevance(search("Aesthetic Stranger Things Poster", "https://www.example.com/pin/8796161770901982/", "https://cdn.example.com/originals/91/17/75.jpg", { engines: ["pinterest"] }), st)).toBe("below_search_score");
    expect(judgeRelevance(search("First Look at Stranger Things Season 2!", "https://openverse.example/31878225093", "https://openverse.example/31878225093_b.jpg", { engines: ["openverse"] }), st)).toBe("below_search_score");
  });

  test("a word from another thing with the same name sinks a Bing row (the Jaguar F-Type for the animal); Yandex never reaches a minor", () => {
    const jaguar: RelevanceContext = { ...thing(["Jaguar"]), otherSenseWords: ["car", "marque", "company", "torpedo", "boat", "destroyer", "console", "sculpture"] };
    expect(judgeRelevance(search("New Jaguar F-Type limited edition celebrates E-Type before it dies", "https://www.topgear.com/car-news/british/new-jaguar-f-type-limited-edition", "https://www.topgear.com/sites/default/files/2023/10/007_Jag_F-TYPE.jpg", { engines: ["bing images"] }), jaguar)).toBe("wrong_sense");
    const row = search("Jaguar resting on a branch", "https://www.example.com/jaguar-resting", "https://cdn.example.com/jaguar.jpg", { engines: ["yandex images"] });
    expect(judgeRelevance(row, jaguar)).toBeNull();
    expect(judgeRelevance(row, { ...jaguar, band: "teen" })).toBe("adult_only_engine");
  });

  test("an Etsy print is a stock preview (study R6)", () => {
    expect(judgeRelevance(search("Resting Jaguar Wall Art, Calm Wildlife Portrait", "https://www.etsy.com/listing/4579955423/resting-jaguar-wall-art", "https://i.example.com/originals/37/83.jpg", { engines: ["bing images"] }), thing(["Jaguar"]))).toBe("stock_preview");
  });

  test("the judged sample's people captions: 'entertains the crowds', 'shown how to use her device', a booth", () => {
    const bluey = thing(["Bluey"], "Bluey (TV series)");
    expect(judgeRelevance(commons("Bluey entertains the crowds at Under 5s Day", "", { categories: ["Bluey (TV series)"] }), bluey)).toBe("caption:crowds");
    const kindle = thing(["Amazon Kindle"], "Amazon Kindle");
    expect(judgeRelevance(commons("A recipient of an Amazon Kindle Fire Tablet is shown how to use her device. Newry, 2016", "", { categories: ["Amazon Kindle"] }), kindle)).toBe("caption:her device");
    expect(judgeRelevance(commons("Stranger Things booth at Gamescom 2023", "", { categories: ["Stranger Things"] }), thing(["Stranger Things"], "Stranger Things"))).toBe("caption:booth");
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

  test("an adult's image-search rows from a personal host or a weak engine are left out; Bing's row naming it stays", async () => {
    const show: FixtureSubject = { id: "Q1011", label: "Stranger Things", enwiki: "Stranger Things", description: "television series" };
    use(show, () => [
      { title: "LEGO® TBB Stranger Things Contest: Hawkins Lab", url: "https://www.flickr.com/photos/someone/5123456789", image: pictureUrl(60), engines: ["openverse"] },
      { title: "Eleven - Stranger Things", url: "https://example.com/gallery/8812", image: pictureUrl(61), engines: ["openverse"] },
      { title: "Stranger Things season 4 key art", url: "https://press.example.com/stranger-things-season-4", image: pictureUrl(62), engines: ["bing images"] },
    ]);
    const result = await selectAnswerImages({ subject: "Stranger Things", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.dropped_by_relevance).toEqual({ personal_host: 1, below_search_score: 1 });
    expect(result.set?.items.map((i) => i.source.url)).toEqual(["https://press.example.com/stranger-things-season-4"]);
  });

  test("IMG-QUALITY-01a: a disc or label scan is left out and counted as disc_or_label; a normal photo is not", async () => {
    const singer: FixtureSubject = { id: "Q1013", label: "Vincent Marlow", human: true, birth: "+1971-01-10T00:00:00Z", category: "Vincent Marlow", image: "Vincent Marlow 2017.jpg", files: ["Vincent Marlow 2017.jpg", "Vincent Marlow white label vinyl.jpg", "Vincent Marlow stage.jpg", "Vincent Marlow 2014.jpg", "Vincent Marlow 2009.jpg"], description: "American singer" };
    __setAnswerImageDepsForTests(fixtureWorld([singer]).deps);
    const result = await selectAnswerImages({ subject: "Vincent Marlow", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.dropped_by_relevance).toEqual({ disc_or_label: 1 });
    expect(result.set?.items.map((i) => i.caption).some((c) => c.includes("white label vinyl"))).toBe(false);
    expect(result.set?.items.length).toBe(4);
  });

  test("the open web only fills a row: with a full row of five good Commons pictures, an adult's search pictures are not used", async () => {
    const tower: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Eiffel Tower lead.jpg", files: ["Eiffel Tower lead.jpg", "Eiffel Tower night.jpg", "Eiffel Tower river.jpg", "Eiffel Tower base.jpg", "Eiffel Tower top.jpg"] };
    use(tower, () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70), engines: ["bing images"] }]);
    const full = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(full.trace.search_not_needed).toBe(1);
    expect(full.set?.items.every((i) => i.source.site === "commons.wikimedia.org")).toBe(true);
    const thin: FixtureSubject = { ...tower, files: ["Eiffel Tower lead.jpg", "Eiffel Tower night.jpg", "Eiffel Tower river.jpg", "Eiffel Tower base.jpg"] };
    use(thin, () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70), engines: ["bing images"] }]);
    const filled = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(filled.trace.search_not_needed).toBeUndefined();
    expect(filled.set?.items.map((i) => i.source.site)).toEqual(["commons.wikimedia.org", "commons.wikimedia.org", "commons.wikimedia.org", "commons.wikimedia.org", "travel.example.com"]);
  });

  test("with Commons enough to fill the row twice over, the open web's pictures are never fetched", async () => {
    const files = Array.from({ length: 11 }, (_, i) => `Eiffel Tower view ${i + 1}.jpg`);
    const tower: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: files[0], files };
    const world = fixtureWorld([tower], { searchRows: () => [{ title: "Eiffel Tower at dusk", url: "https://travel.example.com/eiffel-tower-dusk", image: pictureUrl(70), engines: ["bing images"] }] });
    __setAnswerImageDepsForTests(world.deps);
    const result = await selectAnswerImages({ subject: "Eiffel Tower", actor: people.owner, band: "adult", roster: [] });
    expect(world.log.pictures).not.toContain(pictureUrl(70));
    expect(result.trace.search_held_back).toBe(1);
  });

  // Judged sample (IMGQ-05, 2026-10-06): Star Wars and Jurassic Park showed
  // Commons props, a logo and a cinema marquee; for a film the open web leads.
  test("for a film the open web's pictures lead and Commons only fills", async () => {
    const film: FixtureSubject = { id: "Q1012", label: "Velvet Harbour", film: true, category: "Velvet Harbour", files: ["Velvet Harbour prop.jpg", "Velvet Harbour premiere.jpg", "Velvet Harbour set.jpg"], image: "Velvet Harbour prop.jpg" };
    use(film, () => [1, 2, 3].map((n) => ({ title: `Velvet Harbour still ${n}`, url: `https://press.example.com/velvet-harbour-still-${n}`, image: pictureUrl(80 + n), engines: ["bing images"] })));
    const result = await selectAnswerImages({ subject: "Velvet Harbour", kind: "film", actor: people.owner, band: "adult", roster: [] });
    expect(result.trace.leading_source).toBe("search");
    expect(result.set?.items.slice(0, 3).every((i) => i.source.site === "press.example.com")).toBe(true);
  });

  function use(subject: FixtureSubject, rows: () => { title: string; url: string; image: string; engines?: string[] }[]) {
    const world = fixtureWorld([subject], { searchRows: rows });
    __setAnswerImageDepsForTests(world.deps);
  }
});

describe("IMG-QUALITY-01a: the disc and label veto", () => {
  const singer = person(["Vincent Marlow"], "Vincent Marlow");
  test("a file titled, described or categorised as a disc, label or sleeve is vetoed", () => {
    expect(judgeRelevance(commons("Vincent Marlow white label", "Vincent Marlow single, white label promo"), singer)).toBe("disc_or_label");
    expect(judgeRelevance(commons("Marlow 45", "Vincent Marlow on stage", { categories: ["Vincent Marlow", "Vinyl records"] }), singer)).toBe("disc_or_label");
    expect(judgeRelevance(commons("Marlow single", "The record sleeve of the single", { categories: ["Vincent Marlow"] }), singer)).toBe("disc_or_label");
  });
  test("a normal photo is not vetoed, and the subject's own words are exempt", () => {
    expect(judgeRelevance(commons("Vincent Marlow 2018", "Vincent Marlow in a jacket with long sleeves holding a wine label", { categories: ["Vincent Marlow"] }), singer)).toBeNull();
    expect(judgeRelevance(commons("Vincent Marlow 2017", "Vincent Marlow performing at a festival", { categories: ["Vincent Marlow", "Music festivals"] }), singer)).toBeNull();
    const records = { ...thing(["Vinyl Records"], "Vinyl Records"), description: "analog sound storage disc" };
    expect(judgeRelevance(commons("Vinyl Records stack", "A stack of vinyl records in a shop", { categories: ["Vinyl Records"] }), records)).not.toBe("disc_or_label");
  });
});

// IMGQ-07: the judged sample of 2026-10-12 (data-scratch/chat-ab/imgq-05-2026-10-12/sample/judging.json, 43 subjects,
// every tile opened by eye). The captions and file names below are the real rows of the tiles judged wrong.
describe("IMGQ-07: off-focus, not-named and private-person rows from the judged sample", () => {
  const withKind = (names: string[], kind: string, extra: Partial<RelevanceContext> = {}): RelevanceContext => ({ ...thing(names), kind, ...extra });

  test("A1: a franchise, product or site row must name the subject in its title or description", () => {
    const machu = withKind(["Machu Picchu"], "ruins");
    expect(judgeRelevance(commons("Trail at the old citadel", "Stone terraces above the river", { categories: ["Machu Picchu"] }), machu)).toBe("subject_not_named");
    expect(judgeRelevance(commons("Machu Picchu terraces", "Stone terraces", { categories: ["Machu Picchu"] }), machu)).toBeNull();
    // the article's own lead image is exempt; a thing with no kind is judged as before.
    expect(judgeRelevance(commons("Trail at the old citadel", "", { lead: true }), machu)).toBeNull();
    expect(judgeRelevance(commons("Trail at the old citadel", "Stone terraces above the river", { categories: ["Machu Picchu"] }), thing(["Machu Picchu"]))).toBe("one_signal");
  });

  test("A1 reaches a franchise through the entity's media flag", () => {
    const jurassic = withKind(["Jurassic Park"], "", { media: true });
    expect(judgeRelevance(commons("Kilauea pasture 02", "The location near Kilauea, Hawaii.", { categories: ["Jurassic Park"] }), jurassic)).toBe("subject_not_named");
  });

  test("A2: the Covid Wars cinema marquee parody is dropped from Star Wars", () => {
    const starwars = withKind(["Star Wars"], "film", { media: true });
    expect(judgeRelevance(commons("Covid Wars - Episode 3 - A New Hope - Gartenbaukino", "Gartenbaukino. Dort wo normalerweise das aktuelle Kinoprogramm verkundet wird, stand wahrend der Coronavirus Star Wars", { categories: ["Star Wars"] }), starwars)).toBe("off_focus:parody");
  });

  test("A2: factory workers assembling an iPhone are dropped", () => {
    const iphone = withKind(["iPhone"], "phone");
    expect(judgeRelevance(commons("Barisan pemasangan pembuatan iPhone oleh Tata Electronics di India", "Tata Electronics berusahasama dengan Winstron untuk memasang iPhone di India.", { categories: ["iPhone"] }), iphone)).toBe("off_focus:factory_workers");
  });

  test("A2: a brick wall detail and a courtyard are dropped from a site by their Commons category", () => {
    const taj = withKind(["Taj Mahal"], "mausoleum");
    expect(judgeRelevance(commons("Taj Mahal", "", { categories: ["Taj Mahal", "Brick wall details"] }), taj)).toBe("off_focus:wall_detail");
    expect(judgeRelevance(commons("Taj Mahal", "", { categories: ["Taj Mahal", "Courtyards in India"] }), taj)).toBe("off_focus:courtyard");
    expect(judgeRelevance(commons("Taj Mahal at dawn", "The Taj Mahal at dawn", { categories: ["Taj Mahal"] }), taj)).toBeNull();
    // a subject whose own name holds the word is exempt.
    const wall = withKind(["Great Wall of China"], "wall");
    expect(judgeRelevance(commons("Great Wall of China wall details", "", { categories: ["Great Wall of China", "Wall details"] }), wall)).toBeNull();
  });

  test("A3: a product row of a named private person using the product is dropped", () => {
    const kindle = withKind(["Amazon Kindle", "Kindle"], "e-reader");
    expect(judgeRelevance(commons("Aileen and the CTLE Kindle 2 (3974596562)", "On Thursday, October 1, CTLE Instructional Technology and Enrichment Specialist Aileen McHale taught a workshop on the Kindle", { categories: ["Kindle 2"] }), kindle)).toBe("private_person");
    expect(judgeRelevance(commons("Kindle 7th gen", "A Kindle 7th gen on a table", { categories: ["Kindle"] }), kindle)).toBeNull();
    // the same words about a thing that is not a product are not this rule.
    expect(judgeRelevance(commons("Kindle in a workshop", "A Kindle", { categories: ["Kindle"] }), thing(["Kindle"]))).toBeNull();
  });

  test("A3: conference panels of private people filed under a franchise are dropped (Stranger Things, NMD 2018 and MEGACON)", () => {
    const stranger = withKind(["Stranger Things"], "TV series", { media: true });
    expect(judgeRelevance(commons("Stranger things - NMD 2018 (40059456050)", "Nordiske Mediedager 2018", { categories: ["Stranger Things"] }), stranger)).toBe("caption:mediedager");
    expect(judgeRelevance(commons("MEGACON 2024 Stranger Things Q&A panel - 2", "Actors at MEGACON Orlando speaking at a \"Stranger Things\" Q&A panel", { categories: ["Stranger Things"] }), stranger)).toBe("caption:megacon");
  });
});

// IMGQ-08: the exact Commons rows (title, description, categories, read live on 2026-10-12 into
// data-scratch/chat-ab/imgq-08-2026-10-12) behind the 7 wrong-subject questions the IMGQ-07 replay left, and the held-out rows.
describe("IMGQ-08: a tagged file is not a picture of what it is tagged with", () => {
  const png = (title: string, description: string, categories: string[]): RelevanceInput => ({ ...commons(title, description, { categories }), page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.png` });
  const withKind = (names: string[], kind: string): RelevanceContext => ({ ...thing(names), kind });

  test("a Commons PNG that is not the lead (Serena Williams' signature, the Kindle font menu, a Michael Jackson tribute event) is dropped", () => {
    expect(judgeRelevance(png("SerenaWilliamsSignature", "Signature of Serena Williams", ["Serena Williams"]), person(["Serena Williams"], "Serena Williams"))).toBe("png_not_photo");
    expect(judgeRelevance(png("Kindle accessibility font menu", "kindle accessibility font menu", ["Amazon Kindle"]), withKind(["Amazon Kindle", "Kindle"], "e-reader"))).toBe("png_not_photo");
    expect(judgeRelevance(png("Evento \"Domingo na Paulista\" - Sesi & FIESP - São Paulo 2018", "Estávamos passeando na paulista e estava acontecendo um show em homenagem ao Michael Jackson no dia dos Pais.", ["Avenida Paulista", "Michael Jackson"]), person(["Michael Jackson"], "Michael Jackson"))).toBe("png_not_photo");
  });

  test("the article's own lead stays even when it is a PNG, and JPEG photos are not touched", () => {
    expect(judgeRelevance({ ...png("PlayStation 5 and DualSense with transparent background", "", ["PlayStation 5"]), lead: true }, thing(["PlayStation 5"]))).toBeNull();
    expect(judgeRelevance(commons("Serena Williams 2013", "Serena Williams at the US Open", { categories: ["Serena Williams"] }), person(["Serena Williams"], "Serena Williams"))).toBeNull();
  });

  test("an office photo filed in 'Amazon Kindle' beside three office categories is dropped (IT-Zeux im MUC-office)", () => {
    const row = commons("IT-Zeux im MUC-office 14", "Smarphones von apple, samsung, Dell-PC, Kindle E-reader, Memorysticks etc. im MUC-Office Zeppelinstr. 41", { categories: ["Amazon Kindle", "IT-Technik Pimpinellus", "Office mit PC und Labtop", "Offices and library in Stadthaus (Munich)"] });
    expect(judgeRelevance(row, withKind(["Amazon Kindle", "Kindle"], "e-reader"))).toBe("crowded_categories");
  });

  test("an in-flight meal photo and a festival street display tagged with the subject are dropped (Sushi, Game Boy)", () => {
    const meal = commons("After take-off (5793253862)", "Champagne: Roederer Brut\nAssorted Canapé / Sushi\n\nTK051 from Tokyo to Istanbul", { categories: ["First class in-flight meals", "Sushi", "Turkish Airlines in-flight meals"] });
    expect(judgeRelevance(meal, thing(["Sushi"], "Sushi"))).toBe("crowded_categories");
    const street = commons("Carrers guarnits Gràcia 2012 - Plaça Rovira, Recreatius Rovira 04", "A large model of a Game Boy system on display at a decorated streets contest (Festa Major de Gràcia, Barcelona, year 2012.)", { categories: ["Game Boy", "Plaça Rovira i Trias in Festa Major de Gràcia 2012", "Tetris"] });
    expect(judgeRelevance(street, thing(["Game Boy"], "Game Boy"))).toBe("crowded_categories");
  });

  test("a file whose title names the subject is kept however many categories it has", () => {
    const row = commons("Machu Picchu panorama", "", { categories: ["Machu Picchu", "Inca Empire", "Panoramas of Peru"] });
    expect(judgeRelevance(row, thing(["Machu Picchu"], "Machu Picchu"))).toBeNull();
  });

  test("a person's file is not subject to the crowded-category rule", () => {
    const row = commons("Kyoto Prize ceremony", "Albert Einstein medal", { categories: ["Albert Einstein", "Awards", "Kyoto"] });
    expect(judgeRelevance(row, person(["Albert Einstein"], "Albert Einstein"))).not.toBe("crowded_categories");
  });

  test("Taj Mahal: a bulk-renamed title with the name swallowed ('Banke bTaj Mahalihari') is dropped though its description repeats the category", () => {
    expect(judgeRelevance(commons("Banke bTaj Mahalihari (219)", "Taj Mahal", { categories: ["Taj Mahal"] }), thing(["Taj Mahal"], "Taj Mahal"))).toBe("title_name_glued");
    expect(judgeRelevance(commons("Taj Mahal at dawn", "Taj Mahal", { categories: ["Taj Mahal"] }), thing(["Taj Mahal"], "Taj Mahal"))).toBeNull();
    // a derived word that merely starts with the name is an ordinary title, not a mangled one.
    expect(judgeRelevance(commons("Parisian cafe terrace", "A cafe terrace in Paris", { categories: ["Paris"] }), thing(["Paris"], "Paris"))).not.toBe("title_name_glued");
  });

  test("Ramen: a delivery-machine description listing five foods with the subject second counts as a weak list", () => {
    expect(isWeakEvidence(commons("Demaeki", "Home delivery of cooked foods machine, ramen, sushi, soba, udon", { categories: ["Blue Honda Super Cub", "Ramen"] }), { names: subjectNames(["Ramen"]) })).toBe("description_list");
    expect(isWeakEvidence(commons("Ramen bowl", "Tonkotsu ramen, with egg, nori, scallion"), { names: subjectNames(["Ramen"]) })).toBeNull();
  });
});

// IMGQ-10: Commons structured data (P180 "depicts") orders and recalls; it never exempts. Rows are the captured
// Commons answers of the judged sample and held-out split (2026-10-12).
describe("IMGQ-10: depicts is a signal behind the vetoes, never an exemption", () => {
  const obama = person(["Barack Obama", "Obama"], "Barack Obama");

  test("the Obama family photo in Rio (daughters in the description, 'Malia Obama in 2011' in its categories) is dropped even when depicts names Obama", () => {
    const row = commons("Obama family in mist in Rio de Janeiro", "United States President Barack Obama, First Lady Michelle Obama, and daughters Sasha and Malia in the mist", { depicts: true, categories: ["Barack Obama in Brazil, March 19-21 2011", "Cristo Redentor in 2011", "Malia Obama in 2011", "Michelle Obama in 2011"] });
    expect(judgeRelevance(row, obama)).toBe("minor:daughters");
  });

  test("a person's file filed under another named person's own category is dropped, a file in the subject's own is not", () => {
    const other = commons("Obama with a visitor", "Barack Obama at a reception", { depicts: true, categories: ["Barack Obama in 2011", "Michelle Obama in 2011"] });
    expect(judgeRelevance(other, obama)).toBe("category_person");
    const own = commons("Obama Portrait 2006", "Barack Obama delivers a speech at the University of Southern California", { depicts: true, categories: ["Barack Obama in California", "Portraits of Barack Obama"] });
    expect(judgeRelevance(own, obama)).toBeNull();
  });

  test("depicts never skips the PNG veto, the naming rules or the crowded-category rule", () => {
    const tower = thing(["Eiffel Tower"], "Eiffel Tower");
    expect(judgeRelevance({ ...commons("Eiffel diagram", "Eiffel Tower", { depicts: true, categories: ["Eiffel Tower"] }), page: "https://commons.wikimedia.org/wiki/File:Eiffel_diagram.png" }, tower)).toBe("png_not_photo");
    const phone: RelevanceContext = { ...thing(["iPhone"], "IPhone"), kind: "phone" };
    expect(judgeRelevance(commons("Avions à l'aéroport de Madrid 2015", "", { depicts: true, categories: ["Aeropuerto de Madrid-Barajas T4S", "Runways of Adolfo Suárez Madrid-Barajas Airport"] }), phone)).toBe("subject_not_named");
  });

  test("an airport photo 'taken with an iPhone 6' depicts the phone as its camera: the title must say the subject too", () => {
    const phone: RelevanceContext = { ...thing(["iPhone"], "IPhone"), kind: "phone" };
    const row = commons("Avions à l'aéroport de Madrid 2015", "This photograph was taken with an iPhone 6", { depicts: true, categories: ["Aeropuerto de Madrid-Barajas T4S", "Runways of Adolfo Suárez Madrid-Barajas Airport"] });
    expect(judgeRelevance(row, phone)).toBe("one_signal");
  });

  test("a file whose title names the subject and sits in no naming category counts depicts as its second signal", () => {
    const notre = thing(["Notre-Dame de Paris", "Notre Dame"], "Notre-Dame de Paris");
    const cats = ["2014 photographs of Paris", "Front views of statues"];
    const row = commons("Paris, Notre Dame -- 2014 -- 1458-65", "Sculptures of the kings of Judea at the west front of Notre-Dame, Paris", { categories: cats });
    expect(judgeRelevance(row, notre)).toBe("one_signal");
    expect(judgeRelevance({ ...row, depicts: true }, notre)).toBeNull();
  });

  test("a view from the subject is not of it, for a thing and not for a person ('Champ de Mars from the Eiffel Tower')", () => {
    const tower = thing(["Eiffel Tower"], "Eiffel Tower");
    expect(judgeRelevance(commons("Champ de Mars from the Eiffel Tower - July 2006 edit", "A two segment panorama of Champ de Mars from the Eiffel Tower", { depicts: true, categories: ["Champ-de-Mars from the third floor of the Eiffel Tower"] }), tower)).toBe("near:from");
    expect(judgeRelevance(commons("Letter", "A letter from Albert Einstein to the president", { categories: ["Albert Einstein"] }), person(["Albert Einstein"], "Albert Einstein"))).toBeNull();
  });

  test("fighter jets 'in front of Mount Fuji' are not the subject", () => {
    const fuji = thing(["Mount Fuji", "Fuji"], "Mount Fuji");
    expect(judgeRelevance(commons("CVW-5 Apr2007", "Aircraft assigned to Carrier Air Wing Five perform a formation flight in front of Mount Fuji, Japan", { depicts: true, categories: ["2007 in aviation in Japan"] }), fuji)).toBe("near:in front of");
  });

  test("standing men in a thing's categories mark a picture of people ('Wearing Pikachu')", () => {
    const pikachu = thing(["Pikachu"], "Pikachu");
    expect(judgeRelevance(commons("Wearing Pikachu (31651470496)", "Wearing Pikachu", { depicts: true, categories: ["College Library, Helen C. White Hall", "Men wearing blue jeans", "Standing men seen from behind in the United States"] }), pikachu)).toBe("category:standing men");
  });
});

describe("IMGQ-10: the depicts search is merged behind the lead and fails soft", () => {
  const file = (n: string, extra: { lead?: boolean; depicts?: boolean } = {}) => ({ url: `https://upload.example.com/${n}.jpg`, page: `https://commons.wikimedia.org/wiki/File:${n}.jpg`, title: n, description: "", lead: false, ...extra });
  const pages = (names: string[]) => ({ query: { pages: Object.fromEntries(names.map((n, i) => [String(i), { title: `File:${n}.jpg`, index: names.length - i, imageinfo: [{ mime: "image/jpeg", url: `https://upload.example.com/${n}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${n}.jpg`, width: 900 }] }])) } });
  beforeEach(() => __resetDepictsForTests());

  test("the lead stays first, depicts files follow in search order, the rest of the category after", () => {
    const merged = mergeDepicts([file("lead", { lead: true }), file("c1"), file("c2")], [file("c2", { depicts: true }), file("d1", { depicts: true })]);
    expect(merged.map((m) => m.title)).toEqual(["lead", "c2", "d1", "c1"]);
    expect(merged.find((m) => m.title === "c2")?.depicts).toBe(true);
    expect(merged.find((m) => m.title === "c1")?.depicts).toBeUndefined();
  });

  test("a lead that depicts also names the subject carries the depicts mark", () => {
    const merged = mergeDepicts([file("lead", { lead: true })], [file("lead", { depicts: true, lead: true })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.depicts).toBe(true);
  });

  test("an empty depicts answer leaves the category answer as it was", () => {
    const category = [file("lead", { lead: true }), file("c1")];
    expect(mergeDepicts(category, [])).toEqual(category);
  });

  test("one search per item, cached; the request is the structured-data search on the item's Q-id", async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => { urls.push(url); return pages(["a", "b"]); };
    const first = await wikimediaDepicts({ id: "Q243", image: undefined }, fetchJson, { now: 1000 });
    const again = await wikimediaDepicts({ id: "Q243", image: undefined }, fetchJson, { now: 2000 });
    expect(first.map((f) => f.title)).toEqual(["b", "a"]);
    expect(first.every((f) => f.depicts === true)).toBe(true);
    expect(again).toEqual(first);
    expect(urls).toEqual([depictsUrl("Q243")]);
    expect(decodeURIComponent(urls[0]!)).toContain("haswbstatement:P180=Q243");
  });

  test("an id that is not a Wikidata item asks nothing", async () => {
    let calls = 0;
    expect(await wikimediaDepicts({ id: "commons:Foo", image: undefined }, async () => { calls++; return {}; })).toEqual([]);
    expect(calls).toBe(0);
  });

  test("the first failure (a 429) returns no files, never throws, and keeps the search quiet for 15 minutes", async () => {
    let calls = 0;
    const failing = async () => { calls++; throw new Error("HTTP 429"); };
    expect(await wikimediaDepicts({ id: "Q1", image: undefined }, failing, { now: 0 })).toEqual([]);
    expect(await wikimediaDepicts({ id: "Q2", image: undefined }, failing, { now: 60_000 })).toEqual([]);
    expect(calls).toBe(1);
    expect(await wikimediaDepicts({ id: "Q2", image: undefined }, async () => pages(["z"]), { now: 16 * 60_000 })).toHaveLength(1);
  });

  test("the local pace running out is not the service pushing back and does not start the quiet window", async () => {
    await wikimediaDepicts({ id: "Q3", image: undefined }, async () => { throw new Error("paced: wait"); }, { now: 0 });
    expect(await wikimediaDepicts({ id: "Q4", image: undefined }, async () => pages(["y"]), { now: 1000 })).toHaveLength(1);
  });
});

describe("SEARCH-ANSWER-09: made images and relatives are not photos of the subject", () => {
  const mj = person(["Michael Jackson"], "Michael Jackson");
  const mjDrawings = person(["Michael Jackson drawings", "Michael Jackson"], "Michael Jackson");
  const cats = { categories: ["Michael Jackson"] };

  test("'photos of Michael Jackson' drops a 'drawing of Michael Jackson' caption", () => {
    expect(judgeRelevance(commons("Drawing of Michael Jackson", "A drawing of Michael Jackson", cats), mj)).toBe("caption:drawing");
    expect(judgeRelevance(commons("Michael Jackson caricature", "", cats), mj)).toBe("caption:caricature");
  });

  test("'drawings of Michael Jackson' keeps the drawing", () => {
    expect(judgeRelevance(commons("Michael Jackson drawing", "A drawing of Michael Jackson", cats), mjDrawings)).toBeNull();
  });

  test("'Janet Jackson, sister of Michael Jackson' is dropped for 'photos of Michael Jackson'", () => {
    expect(judgeRelevance(commons("Janet Jackson", "Janet Jackson, sister of Michael Jackson", cats), mj)).toBe("caption:sister of");
  });

  test("plain 'Michael Jackson performing in 1988' is kept", () => {
    expect(judgeRelevance(commons("Michael Jackson performing in 1988", "Michael Jackson performing in 1988", cats), mj)).toBeNull();
  });

  test("an asked 'Janet Jackson' keeps a 'Janet Jackson, sister of Michael Jackson' caption", () => {
    const janet = person(["Janet Jackson"], "Janet Jackson");
    expect(judgeRelevance(commons("Janet Jackson", "Janet Jackson, sister of Michael Jackson", { categories: ["Janet Jackson"] }), janet)).toBeNull();
  });
});
