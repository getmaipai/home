// Image-search accuracy study (data-scratch/research/image-search-accuracy-
// study.md, 2026-10-06), rules R1 and R2, and the owner's ruling on names
// with several meanings: pictures only when the meaning is clear, from the
// kind of thing the model names. The Wikipedia pages and Wikidata senses
// below are the study's own recorded ones (senses.json, wp.json).
import { describe, expect, test } from "bun:test";
import { kindScore, resolveWikimediaSubject, type FetchJson } from "@/lib/answerImages/wikimedia";

type Sense = { id: string; label: string; description: string; enwiki?: string };
type Subject = { page: { title: string; item?: string; disambiguation?: boolean } | null; senses: Sense[] };

const WORLD: Record<string, Subject> = {
  jaguar: { page: { title: "Jaguar", item: "Q35694" }, senses: [
    { id: "Q30055", label: "Jaguar Cars", description: "former British car company", enwiki: "Jaguar Cars" },
    { id: "Q21170490", label: "Jaguar", description: "British car marque used by Jaguar Land Rover", enwiki: "Jaguar (marque)" },
    { id: "Q35694", label: "jaguar", description: "species of big cat native to the Americas", enwiki: "Jaguar" },
    { id: "Q650601", label: "Atari Jaguar", description: "Fifth-generation home video game console by Atari", enwiki: "Atari Jaguar" },
  ] },
  python: { page: { title: "Python", disambiguation: true }, senses: [
    { id: "Q4167410", label: "Python", description: "Wikimedia disambiguation page", enwiki: "Python" },
    { id: "Q28865", label: "Python", description: "general-purpose programming language", enwiki: "Python (programming language)" },
    { id: "Q271218", label: "Python", description: "genus of reptiles", enwiki: "Python (genus)" },
    { id: "Q184018", label: "python", description: "family of snakes", enwiki: "Pythonidae" },
  ] },
  mercury: { page: { title: "Mercury", disambiguation: true }, senses: [
    { id: "Q60009810", label: "Mercury", description: "male given name" },
    { id: "Q613883", label: "Mercury", description: "automobile marque of the Ford Motor Company", enwiki: "Mercury (automobile)" },
    { id: "Q308", label: "Mercury", description: "first planet from the Solar System and smallest among all, tellurian and with extreme temperatures", enwiki: "Mercury (planet)" },
    { id: "Q925", label: "mercury", description: "chemical element with symbol Hg and atomic number 80", enwiki: "Mercury (element)" },
  ] },
  wednesday: { page: { title: "Wednesday", item: "Q128" }, senses: [
    { id: "Q128", label: "Wednesday", description: "day of the week", enwiki: "Wednesday" },
    { id: "Q105553568", label: "Wednesday", description: "American horror comedy television series", enwiki: "Wednesday (TV series)" },
    { id: "Q19498", label: "Sheffield Wednesday F.C.", description: "association football club in Sheffield, England", enwiki: "Sheffield Wednesday F.C." },
  ] },
  croissant: { page: { title: "Croissant", item: "Q207832" }, senses: [
    { id: "Q37152046", label: "Croissant", description: "family name" },
    { id: "Q207832", label: "croissant", description: "French pastry", enwiki: "Croissant" },
  ] },
};

function world(): { fetchJson: FetchJson; calls: string[] } {
  const calls: string[] = [];
  const all = Object.values(WORLD).flatMap((s) => s.senses);
  const fetchJson: FetchJson = async (raw) => {
    calls.push(raw);
    const url = new URL(raw);
    if (url.hostname === "en.wikipedia.org") {
      const s = WORLD[(url.searchParams.get("titles") ?? "").toLowerCase()];
      if (!s?.page) return { query: { pages: { "-1": { title: url.searchParams.get("titles"), missing: "" } } } };
      return { query: { pages: { "1": { title: s.page.title, pageprops: s.page.disambiguation ? { disambiguation: "", wikibase_item: "Q4167410" } : { wikibase_item: s.page.item }, extract: `${s.page.title} intro.` } } } };
    }
    if (url.searchParams.get("action") === "wbsearchentities") {
      const s = WORLD[(url.searchParams.get("search") ?? "").toLowerCase()];
      return { search: (s?.senses ?? []).map((x) => ({ id: x.id, label: x.label, description: x.description })) };
    }
    if (url.searchParams.get("action") === "wbgetentities") {
      const out: Record<string, unknown> = {};
      for (const id of url.searchParams.get("ids")!.split("|")) {
        const x = all.find((y) => y.id === id);
        if (x) out[id] = { claims: {}, labels: { en: { value: x.label } }, descriptions: { en: { value: x.description } }, sitelinks: x.enwiki ? { enwiki: { title: x.enwiki } } : {} };
      }
      return { entities: out };
    }
    throw new Error(`unexpected ${raw}`);
  };
  return { fetchJson, calls };
}

const pick = async (subject: string, kind: string) => {
  const w = world();
  const r = await resolveWikimediaSubject(subject, w.fetchJson, kind);
  return { r, calls: w.calls };
};

describe("R1: the subject's own Wikipedia page names the item; the kind chooses among things with the same name", () => {
  test("croissant: the page's pastry, not the family name the Wikidata label search found first", async () => {
    const { r } = await pick("croissant", "pastry");
    expect("entity" in r && r.entity.id).toBe("Q207832");
  });

  test("Jaguar: the animal by default and for 'animal'; the car marque for 'car'", async () => {
    const animal = await pick("Jaguar", "animal");
    expect("entity" in animal.r && animal.r.entity.id).toBe("Q35694");
    const car = await pick("Jaguar", "car");
    // Either car item (the company or its marque) is the car meaning.
    expect(["Q30055", "Q21170490"]).toContain("entity" in car.r ? car.r.entity.id : "");
  });

  test("Python (a disambiguation page): the snakes for 'snake', the language for 'programming language', and no pictures with no kind", async () => {
    const snake = await pick("Python", "snake");
    expect("entity" in snake.r && snake.r.entity.id).toBe("Q184018");
    const lang = await pick("Python", "programming language");
    expect("entity" in lang.r && lang.r.entity.id).toBe("Q28865");
    const none = await pick("Python", "");
    expect(none.r).toEqual({ skipped: "ambiguous" });
  });

  test("Wednesday: the TV series for 'TV series', though the page is the day", async () => {
    const { r } = await pick("Wednesday", "TV series");
    expect("entity" in r && r.entity.id).toBe("Q105553568");
  });

  test("never more than three Wikimedia calls (page and search side by side, then the item)", async () => {
    const { calls } = await pick("Mercury", "planet");
    expect(calls).toHaveLength(3);
  });
});

describe("R2 and R4: what the open web is asked for, and the other senses' words", () => {
  test("the chosen item's own title when the subject's page is another thing; the subject as given otherwise", async () => {
    const mercury = await pick("Mercury", "planet");
    expect("entity" in mercury.r && mercury.r.entity.queryTitle).toBe("Mercury (planet)");
    const tv = await pick("Wednesday", "TV series");
    expect("entity" in tv.r && tv.r.entity.queryTitle).toBe("Wednesday (TV series)");
    const animal = await pick("Jaguar", "animal");
    expect("entity" in animal.r && animal.r.entity.queryTitle).toBeUndefined();
  });

  test("words from the other things named Jaguar mark a row as the wrong one; the animal's own words never do", async () => {
    const { r } = await pick("Jaguar", "animal");
    const words = "entity" in r ? r.entity.otherSenseWords ?? [] : [];
    expect(words).toEqual(expect.arrayContaining(["car", "marque", "console"]));
    expect(words).not.toContain("species");
    expect(words).not.toContain("jaguar");
  });
});

describe("code review findings (IMGSEARCH-01)", () => {
  // MediaWiki sends `disambiguation: ""` (falsy) and the page's own item.
  test("a real disambiguation page (empty-string flag, an item of its own) is never taken as the subject", async () => {
    const none = await pick("Python", "");
    expect(none.r).toEqual({ skipped: "ambiguous" });
  });

  test("a given name's words ('male', 'given') never mark a row as another thing", async () => {
    const { r } = await pick("Mercury", "planet");
    const words = "entity" in r ? r.entity.otherSenseWords ?? [] : [];
    expect(words).not.toContain("male");
    expect(words).not.toContain("given");
    expect(words).toEqual(expect.arrayContaining(["automobile", "chemical"]));
  });
});

describe("kindScore", () => {
  test("matches the kind's words, plurals and common spellings", () => {
    expect(kindScore("TV series", "American horror comedy television series")).toBeGreaterThan(0);
    expect(kindScore("snake", "family of snakes")).toBe(1);
    expect(kindScore("car", "British car marque used by Jaguar Land Rover")).toBe(1);
    expect(kindScore("animal", "day of the week")).toBe(0);
  });
});
