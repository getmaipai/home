// ANSWER-IMG-02 tests' shared outside world: a fixture Wikidata/Wikipedia/
// Commons (answering the exact API shapes the resolver asks for), a fixture
// picture host serving generated, licence-clean synthetic photos, and a
// fixture SearXNG image search. Nothing is downloaded or vendored.
import sharp from "sharp";
import type { AnswerImageDeps } from "@/lib/answerImages/select";
import type { SearxngImageRow } from "@/lib/packageHost";

/** Draws seed-placed rectangles over an RGB buffer: the unique corners a
 * real photo has. A repeating pattern alone gives a feature matcher nothing
 * to align (IMGSIM-01), and its scaled-down look is the same for every seed. */
export function addShapes(data: Buffer, width: number, height: number, seed: number): void {
  let state = (seed * 2654435761 + 1) >>> 0;
  const rnd = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
  for (let k = 0; k < 40; k++) {
    const w = Math.max(2, Math.round(width * (0.03 + rnd() * 0.12))), h = Math.max(2, Math.round(height * (0.03 + rnd() * 0.12)));
    const x0 = Math.floor(rnd() * (width - w)), y0 = Math.floor(rnd() * (height - h));
    const c = [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
    // Shift the texture under the shape rather than painting it flat, so the
    // picture keeps its fine detail (and its sharpness) and gains corners.
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * width + x) * 3; data[i] = (data[i]! + c[0]!) & 255; data[i + 1] = (data[i + 1]! + c[1]!) & 255; data[i + 2] = (data[i + 2]! + c[2]!) & 255; }
  }
}

/** A synthetic photo: busy enough to pass the quality filter, and distinct
 * per seed (the ANSWER-IMG-00 fixture recipe). */
export async function syntheticPhoto(seed: number, width = 720, height = 540): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    data[i] = (x * 7 + y * 3 + seed * 39) % 256;
    data[i + 1] = (y * 9 + x * 2 + seed * 71) % 256;
    data[i + 2] = ((x ^ (y * seed)) + seed * 23) % 256;
  }
  addShapes(data, width, height, seed);
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer());
}

export type FixtureSubject = {
  id: string;
  label: string;
  human?: boolean;
  birth?: string;
  enwiki?: string | null;
  category?: string;
  image?: string;
  extract?: string;
  /** File names in the Commons category; each is served as a distinct photo. */
  files?: string[];
  description?: string;
  /** Wikidata P31 for a film (Q11424): pictures from the open web lead. */
  film?: boolean;
};

export type WorldLog = { wikimedia: string[]; searches: Array<{ query: string; band: string }>; pictures: string[] };

/** The picture host: `https://upload.example/<seed>.jpg` is that seed's photo. */
export function pictureUrl(seed: number): string {
  return `https://upload.example/${seed}.jpg`;
}

export function fixtureWorld(subjects: FixtureSubject[], opts: { searchRows?: (query: string) => SearxngImageRow[]; pictureDelayMs?: number; wikimediaDelayMs?: number; failPictures?: boolean } = {}): { deps: AnswerImageDeps; log: WorldLog } {
  const log: WorldLog = { wikimedia: [], searches: [], pictures: [] };
  const bySearch = new Map(subjects.map((s) => [s.label.toLowerCase(), s]));
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const fileSeed = new Map<string, number>();
  let nextSeed = 2;
  for (const s of subjects) for (const f of s.files ?? []) if (!fileSeed.has(f)) fileSeed.set(f, nextSeed++);
  const claim = (value: unknown) => [{ mainsnak: { datavalue: { value } } }];
  const delay = (ms = 0) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const fetchJson = async (raw: string): Promise<unknown> => {
    log.wikimedia.push(raw);
    await delay(opts.wikimediaDelayMs);
    const url = new URL(raw);
    const action = url.searchParams.get("action");
    if (url.hostname === "www.wikidata.org" && action === "wbsearchentities") {
      const hit = bySearch.get((url.searchParams.get("search") ?? "").toLowerCase());
      return { search: hit ? [{ id: hit.id, label: hit.label, description: hit.description ?? "" }] : [] };
    }
    if (url.hostname === "www.wikidata.org" && action === "wbgetentities") {
      const ids = (url.searchParams.get("ids") ?? "").split("|");
      const s = ids.map((id) => byId.get(id)).find((x) => x !== undefined);
      if (!s) return { entities: {} };
      const claims: Record<string, unknown[]> = { P31: [{ mainsnak: { datavalue: { value: { id: s.human ? "Q5" : s.film ? "Q11424" : "Q811979" } } } }] };
      if (s.birth) claims.P569 = claim({ time: s.birth });
      if (s.category) claims.P373 = claim(s.category);
      if (s.image) claims.P18 = claim(s.image);
      return { entities: { [s.id]: { claims, labels: { en: { value: s.label } }, descriptions: { en: { value: s.description ?? "" } }, sitelinks: s.enwiki === null ? {} : { enwiki: { title: s.enwiki ?? s.label } } } } };
    }
    if (url.hostname === "commons.wikimedia.org") {
      const category = url.searchParams.get("gcmtitle")?.replace(/^Category:/, "");
      const s = subjects.find((x) => (category ? x.category === category : `File:${x.image}` === url.searchParams.get("titles")));
      const files = category ? s?.files ?? [] : s?.image ? [s.image] : [];
      const pages = Object.fromEntries(files.map((f, i) => [String(-1 - i), {
        title: `File:${f}`,
        imageinfo: [{ thumburl: pictureUrl(fileSeed.get(f) ?? 1), url: pictureUrl(fileSeed.get(f) ?? 1), descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f)}`, mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: "<a href=\"x\">Iris</a>" }, ImageDescription: { value: `${s?.label} photo ${f}` } } }],
      }]));
      return { query: { pages } };
    }
    if (url.hostname === "en.wikipedia.org" && url.pathname === "/w/api.php") {
      // The subject's own page (study R1): a subject with no English article
      // has no page; otherwise its item and intro.
      const wanted = (url.searchParams.get("titles") ?? "").toLowerCase();
      const s = subjects.find((x) => x.label.toLowerCase() === wanted || (x.enwiki ?? "").toLowerCase() === wanted);
      if (!s || s.enwiki === null) return { query: { pages: { "-1": { title: url.searchParams.get("titles"), missing: "" } } } };
      const title = s.enwiki ?? s.label;
      return { query: { pages: { "1": { title, pageprops: { wikibase_item: s.id }, extract: s.extract ?? `${title} is a thing.` } } } };
    }
    if (url.hostname === "en.wikipedia.org") {
      const title = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/_/g, " ");
      const s = subjects.find((x) => (x.enwiki ?? x.label) === title);
      return { type: "standard", extract: s?.extract ?? `${title} is a thing.` };
    }
    throw new Error(`unexpected Wikimedia call ${raw}`);
  };
  const photos = new Map<number, Promise<Uint8Array>>();
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input.toString());
    log.pictures.push(url.toString());
    await delay(opts.pictureDelayMs);
    if (opts.failPictures || url.hostname !== "upload.example") return new Response("gone", { status: 404 });
    const seed = Number(url.pathname.replace(/\D/g, ""));
    if (!photos.has(seed)) photos.set(seed, syntheticPhoto(seed));
    return new Response(await photos.get(seed)!, { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  return {
    log,
    deps: {
      fetchJson,
      imageSearch: async (query, _actor, band) => {
        log.searches.push({ query, band });
        return opts.searchRows?.(query) ?? [];
      },
      fetchOptions: { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) },
    },
  };
}
