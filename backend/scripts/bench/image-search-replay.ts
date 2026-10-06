// Image-search accuracy study replay (measurement only, offline). Runs Home's
// own resolver (resolveWikimediaSubject, with a `kind`) and open-web rules
// (judgeRelevance and searchScore) over the study's recorded Wikipedia pages,
// Wikidata senses and labelled SearXNG rows
// (data-scratch/research/image-search-study-data/), and scores what would
// be shown against the study's labels. No network: nothing is asked of
// Wikimedia or the household's SearXNG.
//
//   bun run scripts/bench/image-search-replay.ts <study data dir>
//
// The `kind` for each subject is the type word the study itself derived from
// Wikidata (its "type" query form), standing in for what the model names.
// A row whose full-size fetch failed in the study, or whose short side was
// under 200 px, counts as dropped (Home's fetch and size checks would drop it).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWikimediaSubject, type FetchJson } from "@/lib/answerImages/wikimedia";
import { judgeRelevance, searchScore, subjectNames } from "@/lib/answerImages/relevance";

const dir = process.argv[2];
if (!dir) { console.error("usage: image-search-replay.ts <study data dir>"); process.exit(2); }
type Row = { title: string; url: string; img_src: string; resolution?: string; img_format?: string; engines: string[]; label: string; fetch?: { status?: number; w?: number; h?: number } };
type Query = { form: string; q: string; results: Row[] };
type Topic = { id: string; subject: string; category: string; holdout: boolean; wikidata: { intended: string }; wikipedia_bare_page: { page?: string; missing?: boolean; disambig?: boolean; qid?: string }; queries: Query[] };
const study = JSON.parse(readFileSync(join(dir, "results.json"), "utf-8")) as { topics: Topic[] };
const senses = JSON.parse(readFileSync(join(dir, "senses.json"), "utf-8")) as Record<string, { q: string; label: string; desc: string }[]>;
const entities = (JSON.parse(readFileSync(join(dir, "resolved.json"), "utf-8")) as { entities: Record<string, { label: string; desc: string; enwiki?: string }> }).entities;

function replay(t: Topic): FetchJson {
  return async (raw) => {
    const url = new URL(raw);
    if (url.hostname === "en.wikipedia.org") {
      const p = t.wikipedia_bare_page;
      if (!p.page || p.missing) return { query: { pages: { "-1": { title: t.subject, missing: "" } } } };
      return { query: { pages: { "1": { title: p.page, pageprops: p.disambig ? { disambiguation: "", wikibase_item: p.qid } : { wikibase_item: p.qid }, extract: `${p.page}.` } } } };
    }
    if (url.searchParams.get("action") === "wbsearchentities") return { search: (senses[t.id] ?? []).map((s) => ({ id: s.q, label: s.label, description: s.desc })) };
    if (url.searchParams.get("action") === "wbgetentities") {
      const out: Record<string, unknown> = {};
      for (const id of url.searchParams.get("ids")!.split("|")) {
        // The study recorded entities for the items it looked at; a sense it
        // did not look at is treated as having no English article.
        const e = entities[id] ?? (senses[t.id] ?? []).map((s) => ({ label: s.label, desc: s.desc, enwiki: undefined as string | undefined, q: s.q })).find((s) => s.q === id);
        if (e) out[id] = { claims: {}, labels: { en: { value: e.label } }, descriptions: { en: { value: e.desc } }, sitelinks: e.enwiki ? { enwiki: { title: e.enwiki } } : {} };
      }
      return { entities: out };
    }
    throw new Error(`unexpected ${raw}`);
  };
}

type Score = { p3: number; p6: number; p6len: number; wrong: number; junk: number; priv: number; shown: number; atLeast3: number; firstBad: number; n: number };
const zero = (): Score => ({ p3: 0, p6: 0, p6len: 0, wrong: 0, junk: 0, priv: 0, shown: 0, atLeast3: 0, firstBad: 0, n: 0 });
const sets: Record<string, Score> = { tune: zero(), holdout: zero(), ambiguous: zero() };
let resolvedRight = 0, resolvedRightTune = 0, resolvedRightHold = 0, noWikiForm = 0, skipped = 0;
const perTopic: string[] = [];

for (const t of study.topics) {
  const typeQuery = t.queries.find((q) => q.form === "type")?.q ?? "";
  const kind = typeQuery.toLowerCase().startsWith(t.subject.toLowerCase()) ? typeQuery.slice(t.subject.length).trim() : "";
  const r = await resolveWikimediaSubject(t.subject, replay(t), kind);
  const chosen = "entity" in r ? r.entity.id : null;
  const right = chosen === t.wikidata.intended;
  if (right) { resolvedRight++; if (t.holdout) resolvedRightHold++; else resolvedRightTune++; }
  if (!("entity" in r)) { skipped++; perTopic.push(`${t.id}: ${r.skipped} (kind "${kind}")`); continue; }
  const entity = r.entity;
  const query = entity.queryTitle ? t.queries.find((q) => q.form === "wiki") : t.queries.find((q) => q.form === "bare");
  if (!query) { noWikiForm++; perTopic.push(`${t.id}: switched to "${entity.queryTitle}" but the study has no such query`); continue; }
  const names = subjectNames([t.subject, entity.label], [entity.wikipediaTitle]);
  const ctx = { names, searchNames: names, subjectIsPerson: false, band: "adult" as const, ...(entity.otherSenseWords ? { otherSenseWords: entity.otherSenseWords } : {}) };
  const kept = query.results
    .map((row, i) => {
      const size = row.fetch?.w && row.fetch?.h ? Math.min(row.fetch.w, row.fetch.h) : 0;
      const broken = !row.fetch || row.fetch.status !== 200 || size < 200;
      const off = broken ? "broken" : judgeRelevance({ source: "search", lead: false, title: row.title, description: "", page: row.url, image: row.img_src, engines: row.engines, ...(row.img_format ? { format: row.img_format.toLowerCase() } : {}) }, ctx);
      return { row, i, off, score: searchScore({ title: row.title, page: row.url, image: row.img_src, engines: row.engines }, ctx).score, big: size >= 600 ? 1 : 0 };
    })
    .filter((x) => x.off === null)
    .sort((a, b) => b.score - a.score || b.big - a.big || a.i - b.i)
    .slice(0, 12)
    .map((x) => x.row);
  const top = (n: number) => kept.slice(0, n);
  const frac = (rows: Row[], f: (r: Row) => boolean) => (rows.length ? rows.filter(f).length / rows.length : 0);
  for (const key of [t.holdout ? "holdout" : "tune", ...(t.category === "ambiguous" ? ["ambiguous"] : [])]) {
    const s = sets[key]!;
    s.n++;
    s.p3 += frac(top(3), (x) => x.label === "I");
    s.p6 += frac(top(6), (x) => x.label === "I");
    s.p6len += frac(top(6), (x) => x.label === "I" || x.label === "R");
    s.wrong += frac(top(6), (x) => x.label === "W");
    s.junk += frac(top(6), (x) => x.label === "J");
    s.priv += frac(top(6), (x) => x.label === "P");
    s.shown += Math.min(kept.length, 6);
    s.atLeast3 += kept.length >= 3 ? 1 : 0;
    s.firstBad += kept[0] && ["W", "J", "P", "B"].includes(kept[0].label) ? 1 : 0;
  }
  perTopic.push(`${t.id}${t.holdout ? " (held-out)" : ""}: item ${right ? "right" : `WRONG (${chosen} for ${t.wikidata.intended})`}, kind "${kind}", query ${entity.queryTitle ? `"${entity.queryTitle}"` : "as given"}, kept ${kept.length}, top 3 ${top(3).map((x) => x.label).join("")}`);
}
const pct = (x: number, n: number) => `${n ? Math.round((100 * x) / n) : 0}%`;
console.log(`resolver right: ${resolvedRight}/${study.topics.length} (tune ${resolvedRightTune}/62, held-out ${resolvedRightHold}/20); no pictures (skipped): ${skipped}; switched with no recorded query: ${noWikiForm}`);
console.log("set | subjects | P@3 | P@6 | P@6 lenient | wrong | junk | private | first bad | shown (of 6) | at least 3");
for (const [k, s] of Object.entries(sets)) console.log(`${k} | ${s.n} | ${pct(s.p3, s.n)} | ${pct(s.p6, s.n)} | ${pct(s.p6len, s.n)} | ${pct(s.wrong, s.n)} | ${pct(s.junk, s.n)} | ${pct(s.priv, s.n)} | ${pct(s.firstBad, s.n)} | ${(s.shown / Math.max(1, s.n)).toFixed(1)} | ${pct(s.atLeast3, s.n)}`);
if (process.argv.includes("--topics")) console.log(perTopic.join("\n"));
