// IMGQ-13 (docs/plans/imgq-13-entity-resolution-2026-10-12.md section 4): the asked name picks the Wikidata
// entity, sitelinks break ties (items under 40% of the best drop out), and `kind` is only a hint among items
// that already match the name. Each regression below is one wrong picture from the IMGQ-11 fresh check, with
// the labels, descriptions and sitelink counts the live Wikimedia answers had, offline and deterministic.
// The last test replays the saved IMGQ-11 capture (a git-ignored scratch file; skipped when absent).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { foldName, resolveWikimediaSubject, type FetchJson } from "@/lib/answerImages/wikimedia";

type Item = { id: string; label: string; desc: string; links: number; enwiki?: string; matched?: string };
type Scene = { subject: string; page?: { title: string; item?: string; dab?: boolean }; hits: Item[]; items: Item[]; pageLinks?: string[] };

function serve(scene: Scene): { fetchJson: FetchJson; calls: string[] } {
  const calls: string[] = [];
  const all = [...scene.hits, ...scene.items];
  const entity = (x: Item) => ({ id: x.id, claims: {}, labels: { en: { value: x.label } }, descriptions: { en: { value: x.desc } }, sitelinks: Object.fromEntries(Array.from({ length: x.links }, (_, i) => [i === 0 && x.enwiki ? "enwiki" : `w${i}wiki`, { title: x.enwiki ?? x.label }])) });
  const fetchJson: FetchJson = async (raw) => {
    calls.push(raw);
    const url = new URL(raw);
    if (url.hostname === "en.wikipedia.org" && url.searchParams.get("prop") === "links") {
      return { query: { pages: { "1": { links: (scene.pageLinks ?? []).map((title) => ({ title })) } } } };
    }
    if (url.hostname === "en.wikipedia.org") {
      const p = scene.page;
      if (!p) return { query: { pages: { "-1": { title: scene.subject, missing: "" } } } };
      return { query: { pages: { "1": { title: p.title, pageprops: p.dab ? { disambiguation: "" } : { wikibase_item: p.item }, extract: "intro" } } } };
    }
    if (url.searchParams.get("action") === "wbsearchentities") {
      return { search: scene.hits.map((x) => ({ id: x.id, label: x.label, description: x.desc, match: { text: x.matched ?? x.label } })) };
    }
    const titles = url.searchParams.get("titles")?.split("|");
    const wanted = titles ? titles.map((t) => all.find((x) => x.enwiki === t)).filter((x): x is Item => Boolean(x)) : url.searchParams.get("ids")!.split("|").map((id) => all.find((x) => x.id === id)).filter((x): x is Item => Boolean(x));
    return { entities: Object.fromEntries(wanted.map((x) => [x.id, entity(x)])) };
  };
  return { fetchJson, calls };
}
const resolve = async (scene: Scene, kind: string) => {
  const s = serve(scene);
  const r = await resolveWikimediaSubject(scene.subject, s.fetchJson, kind);
  return { r, calls: s.calls, id: "entity" in r ? r.entity.id : `skipped:${(r as { skipped: string }).skipped}` };
};

const statueOfLiberty: Scene = {
  subject: "Statue of Liberty", page: { title: "Statue of Liberty", item: "Q9202" },
  hits: [
    { id: "Q9202", label: "Statue of Liberty", desc: "monument in New York", links: 158, enwiki: "Statue of Liberty" },
    { id: "Q3968681", label: "Statue of Liberty", desc: "1978 single by XTC", links: 5, enwiki: "Statue of Liberty (song)" },
    { id: "Q3064968", label: "Statua della Libertà", matched: "Statue of Liberty", desc: "statue located in San Marino (City)", links: 11, enwiki: "Statua della Libertà" },
    { id: "Q75053182", label: "Statue of Liberty", desc: "statue in Lima District, Peru", links: 3, enwiki: "Statue of Liberty (Peru)" },
  ], items: [],
};

describe("IMGQ-13 regressions from the IMGQ-11 fresh check", () => {
  test("f-20 Statue of Liberty with kind 'statue': the monument, not the San Marino statue (158 vs 11 sitelinks)", async () => {
    const out = await resolve(statueOfLiberty, "statue");
    expect(out.id).toBe("Q9202");
    expect("entity" in out.r && out.r.entity.resolvedVia).toBe("wikipedia");
  });
  test("f-51 tacos with kind 'food': Taco (plural folded), not French tacos", async () => {
    const out = await resolve({ subject: "tacos", page: { title: "Taco", item: "Q191655" }, hits: [
      { id: "Q191655", label: "taco", matched: "Tacos", desc: "Mexican dish consisting of a corn or wheat tortilla folded or rolled around a filling, salsa and vegetabes", links: 73, enwiki: "Taco" },
      { id: "Q30737843", label: "French tacos", matched: "tacos", desc: "fast food recipe created in France", links: 13, enwiki: "French tacos" },
      { id: "Q98398695", label: "Tacos", desc: "2020 single by Little Big", links: 2 },
    ], items: [] }, "food");
    expect(out.id).toBe("Q191655");
  });
  test("f-33 blue whale with kind 'whale': the species, not the skeleton called Hope (3 of 111 sitelinks)", async () => {
    const out = await resolve({ subject: "blue whale", page: { title: "Blue whale", item: "Q42196" }, hits: [
      { id: "Q42196", label: "blue whale", desc: "species of marine mammal, largest living animal in the world", links: 111, enwiki: "Blue whale" },
      { id: "Q139885129", label: "Hope", matched: "blue whale", desc: "skeleton of a blue whale", links: 3, enwiki: "Hope (whale)" },
    ], items: [] }, "whale");
    expect(out.id).toBe("Q42196");
  });
  test("f-61 The Lord of the Rings with kind 'film series': the film series, not Return of the King or the novel or the 1978 film", async () => {
    const scene: Scene = { subject: "The Lord of the Rings", page: { title: "The Lord of the Rings", item: "Q15228" }, hits: [
      { id: "Q15228", label: "The Lord of the Rings", desc: "1954–1955 fantasy novel trilogy by J. R. R. Tolkien", links: 148, enwiki: "The Lord of the Rings" },
      { id: "Q131074", label: "The Lord of the Rings: The Return of the King", desc: "2003 film by Peter Jackson", links: 93, enwiki: "The Lord of the Rings: The Return of the King" },
      { id: "Q190214", label: "The Lord of the Rings", desc: "2001-2003 three films directed by Peter Jackson", links: 73, enwiki: "The Lord of the Rings (film series)" },
      { id: "Q378913", label: "The Lord of the Rings", desc: "1978 animated film by Ralph Bakshi", links: 40, enwiki: "The Lord of the Rings (1978 film)" },
    ], items: [] };
    expect((await resolve(scene, "film series")).id).toBe("Q190214");
    expect((await resolve(scene, "trilogy")).id).toBe("Q15228");
    expect((await resolve(scene, "")).id).toBe("Q15228");
  });
  test("f-64 Hamilton with kind 'musical': the musical the disambiguation page links, though the search's ten hits lack it", async () => {
    const out = await resolve({ subject: "Hamilton", page: { title: "Hamilton", dab: true }, hits: [
      { id: "Q200028", label: "Hamilton", desc: "largest city in New Zealand's Waikato region", links: 80, enwiki: "Hamilton, New Zealand" },
      { id: "Q84323848", label: "Hamilton", desc: "2020 film of the 2015 Broadway musical of the same name", links: 24, enwiki: "Hamilton (2020 film)" },
    ], items: [{ id: "Q19320959", label: "Hamilton", desc: "2015 musical by Lin-Manuel Miranda about Alexander Hamilton", links: 40, enwiki: "Hamilton (musical)" }],
    pageLinks: ["Hamilton (2020 film)", "Hamilton (musical)", "Hamilton, New Zealand", "Alexander Hamilton"] }, "musical");
    expect(out.id).toBe("Q19320959");
    expect(out.calls.filter((c) => c.includes("prop=links"))).toHaveLength(1);
    expect(out.calls.length).toBeLessThanOrEqual(4);
  });
  test("f-14 Amazon with kind 'river': Amazon River from the links call, not skipped as ambiguous", async () => {
    const out = await resolve({ subject: "Amazon", page: { title: "Amazon", dab: true }, hits: [
      { id: "Q3884", label: "Amazon", desc: "American multinational technology company", links: 124, enwiki: "Amazon (company)" },
    ], items: [
      { id: "Q3783", label: "Amazon River", desc: "river in South America", links: 217, enwiki: "Amazon River" },
      { id: "Q177567", label: "Amazon rainforest", desc: "large rainforest in South America", links: 101, enwiki: "Amazon rainforest" },
    ], pageLinks: ["Amazon (company)", "Amazon River", "Amazon rainforest", "Zeus"] }, "river");
    expect(out.id).toBe("Q3783");
  });
  test("a disambiguation page whose links fit no kind is still ambiguous, and so is one with no kind", async () => {
    const scene: Scene = { subject: "Amazon", page: { title: "Amazon", dab: true }, hits: [], items: [
      { id: "Q3783", label: "Amazon River", desc: "river in South America", links: 217, enwiki: "Amazon River" },
    ], pageLinks: ["Amazon River"] };
    expect((await resolve(scene, "painting")).id).toBe("skipped:ambiguous");
    expect((await resolve(scene, "")).id).toBe("skipped:ambiguous");
  });
});

describe("IMGQ-13 rule", () => {
  test("a kind never adds an item whose name differs: with no kind-fitting name match the page's item stays", async () => {
    expect((await resolve(statueOfLiberty, "statue")).id).toBe("Q9202");
    expect((await resolve(statueOfLiberty, "monument")).id).toBe("Q9202");
    expect((await resolve(statueOfLiberty, "")).id).toBe("Q9202");
  });
  test("the 40% cut keeps a notable sibling a kind can still reach and drops a lesser one", async () => {
    const scene = (links: number): Scene => ({ subject: "Wednesday", page: { title: "Wednesday", item: "Q128" }, hits: [
      { id: "Q128", label: "Wednesday", desc: "day of the week", links: 100, enwiki: "Wednesday" },
      { id: "Q105553568", label: "Wednesday", desc: "American horror comedy television series", links, enwiki: "Wednesday (TV series)" },
    ], items: [] });
    expect((await resolve(scene(40), "TV series")).id).toBe("Q105553568");
    expect((await resolve(scene(39), "TV series")).id).toBe("Q128");
  });
  test("equal kind fit: the description with the kind word as written wins over a plural variant (Washington / state)", async () => {
    const out = await resolve({ subject: "Washington", page: { title: "Washington", dab: true }, hits: [], items: [
      { id: "Q61", label: "Washington", desc: "capital city of the United States of America", links: 299, enwiki: "Washington, D.C." },
      { id: "Q1223", label: "Washington", desc: "state of the United States of America", links: 223, enwiki: "Washington (state)" },
    ], pageLinks: ["Washington, D.C.", "Washington (state)"] }, "state");
    expect(out.id).toBe("Q1223");
  });
  test("a page that is a list article falls back to the kind-fit sense, as before (Mini Cooper / car)", async () => {
    const out = await resolve({ subject: "Mini Cooper", page: { title: "Mini Cooper", item: "Q26261760" }, hits: [
      { id: "Q36024", label: "Mini", matched: "Mini Cooper", desc: "British car model made by the British Motor Corporation", links: 44, enwiki: "Mini" },
      { id: "Q26261760", label: "Mini Cooper", desc: "Wikimedia list article", links: 2, enwiki: "Mini Cooper" },
    ], items: [] }, "car");
    expect(out.id).toBe("Q36024");
  });
  test("a subject that carries its own qualifier still matches (Hamilton (musical))", async () => {
    const out = await resolve({ subject: "Hamilton (musical)", page: { title: "Hamilton (musical)", item: "Q19320959" }, hits: [
      { id: "Q19320959", label: "Hamilton", desc: "2015 musical by Lin-Manuel Miranda about Alexander Hamilton", links: 40, enwiki: "Hamilton (musical)" },
    ], items: [] }, "musical");
    expect(out.id).toBe("Q19320959");
  });
  test("a failed entities lookup on a disambiguation page is an error, not 'ambiguous'", async () => {
    const scene: Scene = { subject: "Amazon", page: { title: "Amazon", dab: true }, hits: [], items: [], pageLinks: ["Amazon River"] };
    const s = serve(scene);
    const r = await resolveWikimediaSubject("Amazon", async (url) => { if (url.includes("action=wbgetentities")) throw new Error("HTTP 429"); return s.fetchJson(url); }, "river");
    expect(r).toEqual({ skipped: "error" });
  });
  test("foldName folds case, accents, punctuation and plurals", () => {
    expect(foldName("Tacos")).toBe(foldName("taco"));
    expect(foldName("Café Rouge")).toBe(foldName("cafe rouge"));
    expect(foldName("Families")).toBe(foldName("family"));
    expect(foldName("cookies")).toBe(foldName("Cookie"));
    expect(foldName("Søren")).not.toBe("");
    expect(foldName("東京")).toBe("東京");
    expect(foldName("東京")).not.toBe(foldName("Москва"));
  });
});

const CAPTURE = new URL("../../data-scratch/chat-ab/imgq-11-2026-10-12/cap/capture.json", import.meta.url);
const SCRATCH = new URL("../../data-scratch/chat-ab/imgq-13a/", import.meta.url);
describe.skipIf(!existsSync(CAPTURE) || !existsSync(new URL("extra.json", SCRATCH)) || !existsSync(new URL("old-picks.json", SCRATCH)))("IMGQ-13 replay of the IMGQ-11 capture (67 subjects, offline)", () => {
  test("every pick but the six fixed ones and f-38 is unchanged, the six are fixed, and no subject takes more than 4 calls", async () => {
    const cap = JSON.parse(readFileSync(CAPTURE, "utf8")) as { subjects: Record<string, { subject: string; kind: string; json: Record<string, unknown> }> };
    const extra = JSON.parse(readFileSync(new URL("extra.json", SCRATCH), "utf8")) as Record<string, unknown>;
    const old = JSON.parse(readFileSync(new URL("old-picks.json", SCRATCH), "utf8")) as Record<string, { result: { id?: string; skipped?: string } }>;
    const changed: Record<string, string> = {};
    for (const [id, s] of Object.entries(cap.subjects)) {
      let calls = 0;
      const r = await resolveWikimediaSubject(s.subject, async (url) => {
        calls++;
        if (url in extra) return extra[url];
        if (url in s.json) return s.json[url];
        for (const o of Object.values(cap.subjects)) if (url in o.json) return o.json[url];
        throw new Error(`not captured: ${url}`);
      }, s.kind);
      expect(calls).toBeLessThanOrEqual(4);
      const now = "entity" in r ? r.entity.id : `skipped:${r.skipped}`;
      const before = old[id]!.result.id ?? `skipped:${old[id]!.result.skipped}`;
      if (now !== before) changed[id] = now;
    }
    expect(changed).toEqual({ "f-14": "Q3783", "f-20": "Q9202", "f-33": "Q42196", "f-38": "Q30034", "f-51": "Q191655", "f-61": "Q190214", "f-64": "Q19320959" });
  });
});
