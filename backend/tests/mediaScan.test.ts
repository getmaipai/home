// MEDIA-LIB-01: the scan orchestrator over a fixture tree of every kind.
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import { createRootSource, type RootKind } from "@/lib/media/sources";
import { scanRoot, isScanning } from "@/lib/media/scan";
import { removeSource } from "@/lib/media/sources";
import { findDuplicates } from "@/lib/media/duplicates";
import type { Prober, ProbeResult } from "@/lib/media/prober";
import { itemFromRow } from "@/lib/media/model";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import type { PersonRow } from "@/types";

let admin: PersonRow;

beforeEach(() => {
  resetDb();
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-admin0001", displayName: "Sage", role: "owner", avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  admin = db.select().from(people).where(eq(people.id, "person-admin0001")).get() as unknown as PersonRow;
});

function addRoot(path: string, kinds: RootKind[], label = path.split("/").pop()!) {
  const result = createRootSource(admin, { label, path, kinds });
  if (!result.ok) throw new Error(result.error);
  return result.source;
}

const noProber = { prober: null, pruneGraceMs: 0 } as const;

describe("scan over a fixture tree", () => {
  test("every kind scans to the expected items, twice, with no duplicates", async () => {
    const tree = buildMediaTree();
    const roots = [
      addRoot(tree.videos, ["video"]), addRoot(tree.shows, ["episode"]), addRoot(tree.films, ["film"]),
      addRoot(tree.music, ["track"]), addRoot(tree.reading, ["book", "audiobook"]),
    ];
    for (const root of roots) await scanRoot(root.id, noProber);
    const first = db.select().from(mediaItems).all();
    const titles = (kind: string) => first.filter((row) => row.kind === kind).map((row) => row.title).sort();
    expect(titles("video")).toEqual(["Building a birdhouse", "Fixing a squeaky door", "Sprout at the beach"]);
    expect(titles("episode")).toEqual(["New Season", "Pilot", "The Lighthouse"]);
    expect(titles("film")).toEqual(["Garden Road", "Moon Rivets"]);
    expect(titles("track")).toEqual(["Loud Song", "Morning Light"]);
    expect(titles("audiobook")).toEqual(["Moon Rivets", "The Clockwork Garden"]);
    expect(titles("chapter")).toEqual(["Part 1", "Part 2", "Part 3"]);
    expect(titles("book")).toEqual(["Moon Rivets Field Guide", "The Clockwork Garden"]);

    const ids = new Map(first.map((row) => [`${row.locRootId}:${row.locPath}`, row.id]));
    for (const root of roots) await scanRoot(root.id, noProber);
    const second = db.select().from(mediaItems).all();
    expect(second.length).toBe(first.length);
    // The same rows, the same ids: a re-scan updates, never duplicates.
    expect(new Map(second.map((row) => [`${row.locRootId}:${row.locPath}`, row.id]))).toEqual(ids);
  });
});

const rows = () => db.select().from(mediaItems).all();
const byPath = (path: string) => rows().find((row) => row.locPath === path)!;

describe("what a scan reads from each kind", () => {
  async function scanAll() {
    const tree = buildMediaTree();
    const roots = {
      videos: addRoot(tree.videos, ["video"]), shows: addRoot(tree.shows, ["episode"]), films: addRoot(tree.films, ["film"]),
      music: addRoot(tree.music, ["track"]), reading: addRoot(tree.reading, ["book", "audiobook"]),
    };
    for (const root of Object.values(roots)) await scanRoot(root.id, noProber);
    return { tree, roots };
  }

  test("episodes carry series, season, episode and the show poster; films the year and the NFO plot, never written back", async () => {
    const { tree } = await scanAll();
    const pilot = itemFromRow(byPath("Juniper Bay/Season 1/Juniper Bay S01E01 - Pilot.mp4"));
    expect(pilot).toMatchObject({ kind: "episode", title: "Pilot", series: "Juniper Bay", season: 1, episode: 1, subtitle: "Juniper Bay", artwork: { path: "Juniper Bay/poster.jpg" }, playable: "unknown" });
    const film = itemFromRow(byPath("Moon Rivets (2021).mp4"));
    expect(film).toMatchObject({ kind: "film", title: "Moon Rivets", year: 2021, description: "A small robot repairs the moon.", genre: "Family", artwork: { path: "Moon Rivets (2021).jpg" } });
    expect(existsSync(join(tree.films, "Garden Road.nfo"))).toBe(false);
  });

  test("music reads tags, disc and track, folder art, and the iTunes advisory makes the track adult", async () => {
    await scanAll();
    expect(itemFromRow(byPath("The Marlows/Tempo/01 Morning Light.mp3"))).toMatchObject({
      kind: "track", title: "Morning Light", artist: "The Marlows", album: "Tempo", album_artist: "The Marlows", track_no: 1, year: 2023, genre: "Indie", band_ok: "child",
      artwork: { path: "The Marlows/Tempo/cover.jpg" }, playable: "original", advisory: { explicit: false },
    });
    expect(itemFromRow(byPath("Clover/Singles/01 Loud Song.m4a"))).toMatchObject({ kind: "track", title: "Loud Song", band_ok: "adult", advisory: { explicit: true, source: "tag" } });
  });

  test("an m4b with chapters is one audiobook; a folder of numbered mp3s is one audiobook whose files are chapter items", async () => {
    await scanAll();
    const m4b = itemFromRow(byPath("Iris Quill/The Clockwork Garden.m4b"));
    expect(m4b).toMatchObject({ kind: "audiobook", title: "The Clockwork Garden", author: "Iris Quill", narrator: "Nadia Sage", subtitle: "Iris Quill" });
    expect(m4b.chapters.map((c) => [c.start_s, c.title, c.source])).toEqual([[0, "Chapter 1", "embedded"], [2, "Chapter 2", "embedded"], [4, "Chapter 3", "embedded"]]);
    const book = itemFromRow(byPath("Iris Quill/Moon Rivets"));
    expect(book).toMatchObject({ kind: "audiobook", title: "Moon Rivets", author: "Iris Quill" });
    expect(book.chapters.map((c) => c.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    const parts = rows().filter((row) => row.parentId === book.id).map(itemFromRow).sort((a, b) => (a.track_no ?? 0) - (b.track_no ?? 0));
    expect(parts.map((p) => [p.kind, p.title, p.track_no])).toEqual([["chapter", "Part 1", 1], ["chapter", "Part 2", 2], ["chapter", "Part 3", 3]]);
    expect(book.duration_s).toBeCloseTo(parts.reduce((sum, p) => sum + (p.duration_s ?? 0), 0), 3);
  });

  test("a book and an audiobook of the same title in one folder share a subtitle, so they link", async () => {
    await scanAll();
    const epub = itemFromRow(byPath("Iris Quill/The Clockwork Garden.epub"));
    const audio = itemFromRow(byPath("Iris Quill/The Clockwork Garden.m4b"));
    expect(epub).toMatchObject({ kind: "book", subtitle: "Iris Quill", series: "Garden Tales", locator_kind: "cfi", artwork: { path: "Iris Quill/The Clockwork Garden.epub" } });
    expect(epub.subtitle).toBe(audio.subtitle);
    expect(byPath("Iris Quill/Moon Rivets Field Guide.pdf").pages).toBe(2);
    expect(itemFromRow(byPath("Iris Quill/Moon Rivets Field Guide.pdf"))).toMatchObject({ kind: "book", title: "Moon Rivets Field Guide", locator_kind: "page" });
  });

  test("band_ok: words that trip the minor floor make an item adult, the rest are child", async () => {
    const tree = buildMediaTree();
    writeFileSync(join(tree.videos, "Home videos", "Hardcore porn compilation.mp4"), "x");
    const root = addRoot(tree.videos, ["video"]);
    await scanRoot(root.id, noProber);
    expect(itemFromRow(byPath("Home videos/Hardcore porn compilation.mp4")).band_ok).toBe("adult");
    expect(itemFromRow(byPath("Home videos/Sprout at the beach.mp4")).band_ok).toBe("child");
  });

  test("lyrics trip the child floor and made lyrics survive a rescan without source lyrics", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.videos, ["video"]);
    await scanRoot(root.id, noProber);
    const { bandOkAtIngest } = await import("@/lib/media/band");
    expect(bandOkAtIngest({ explicit: false, title: "Song", lyrics: "explicit porn" }).band).toBe("adult");

    const made = byPath("Bramble Workshop/Building a birdhouse [bw-001].mp4");
    db.update(mediaItems).set({ lyrics: JSON.stringify({ source: "made", text: "Generated verse" }) }).where(eq(mediaItems.id, made.id)).run();
    writeFileSync(join(tree.videos, "Bramble Workshop", "Building a birdhouse [bw-001].mp4"), "changed file");
    await scanRoot(root.id, noProber);
    expect(itemFromRow(byPath("Bramble Workshop/Building a birdhouse [bw-001].mp4")).lyrics).toEqual({ source: "made", text: "Generated verse" });
  });
});

describe("the fast path and changes", () => {
  test("an unchanged file is not parsed again; a changed one is updated in place", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    const first = await scanRoot(root.id, noProber);
    expect(first).toMatchObject({ added: 2, unchanged: 0 });
    const before = byPath("Garden Road.mkv");
    const second = await scanRoot(root.id, noProber);
    expect(second).toMatchObject({ added: 0, updated: 0, unchanged: 2 }); // both films only touched, not parsed
    expect(byPath("Garden Road.mkv").hlc).toBe(before.hlc);
    writeFileSync(join(tree.films, "Garden Road.mkv"), "a longer film file");
    const third = await scanRoot(root.id, noProber);
    expect(third.updated).toBe(1);
    const after = byPath("Garden Road.mkv");
    expect(after.id).toBe(before.id);
    expect(after.addedAt).toBe(before.addedAt);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test("a file renamed on disk is a new item and the old one is pruned only after it stays missing", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    await scanRoot(root.id, noProber);
    renameSync(join(tree.films, "Garden Road.mkv"), join(tree.films, "Garden Road (2019).mkv"));
    const next = await scanRoot(root.id, noProber);
    expect(next).toMatchObject({ added: 1, missing: 1, pruned: 0 });
    expect(byPath("Garden Road.mkv").deletedAt).toBeNull();
    const last = await scanRoot(root.id, noProber);
    expect(last.pruned).toBe(1);
    const gone = byPath("Garden Road.mkv");
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.trashUntil).not.toBeNull();
    // It comes back when the file does.
    renameSync(join(tree.films, "Garden Road (2019).mkv"), join(tree.films, "Garden Road.mkv"));
    await scanRoot(root.id, noProber);
    expect(byPath("Garden Road.mkv").deletedAt).toBeNull();
  });
});

describe("prune guards", () => {
  test("a removed root defers prune: nothing is scanned and no item is deleted", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    await scanRoot(root.id, noProber);
    removeSource(root.id);
    unlinkSync(join(tree.films, "Garden Road.mkv"));
    const summary = await scanRoot(root.id, noProber);
    expect(summary.status).toBe("failed");
    expect(summary.guards).toContain("unattributable_root");
    expect(rows().filter((row) => row.deletedAt)).toHaveLength(0);
    expect(rows()).toHaveLength(2);
  });

  test("a missing root (an unmounted share) defers prune", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    await scanRoot(root.id, noProber);
    renameSync(tree.films, `${tree.films}-away`);
    for (let i = 0; i < 3; i++) expect((await scanRoot(root.id, noProber)).guards).toContain("root_missing");
    expect(rows().filter((row) => row.deletedAt || row.missingSince)).toHaveLength(0);
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, root.id)).get()!.lastStatus).toBe("root_missing");
  });

  test("an empty mount point where a library was defers prune", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    await scanRoot(root.id, noProber);
    rmSync(tree.films, { recursive: true });
    mkdirSync(tree.films);
    for (let i = 0; i < 3; i++) expect((await scanRoot(root.id, noProber)).guards).toContain("root_empty");
    expect(rows().filter((row) => row.deletedAt)).toHaveLength(0);
  });

  test("an unreadable subtree is not pruned", async () => {
    if (process.getuid?.() === 0) return; // root reads everything
    const tree = buildMediaTree();
    const root = addRoot(tree.shows, ["episode"]);
    await scanRoot(root.id, noProber);
    const season = join(tree.shows, "Juniper Bay", "Season 2");
    chmodSync(season, 0o000);
    try {
      for (let i = 0; i < 3; i++) expect((await scanRoot(root.id, noProber)).guards).toContain("unreadable_subtree");
      expect(rows().filter((row) => row.deletedAt)).toHaveLength(0);
    } finally {
      chmodSync(season, 0o755);
    }
  });

  test("prune off keeps everything; most of the library vanishing at once is held back", async () => {
    const tree = buildMediaTree();
    const off = addRoot(tree.films, ["film"]);
    db.update(mediaSources).set({ prune: false }).where(eq(mediaSources.id, off.id)).run();
    await scanRoot(off.id, noProber);
    unlinkSync(join(tree.films, "Garden Road.mkv"));
    expect((await scanRoot(off.id, noProber)).guards).toContain("prune_off");
    await scanRoot(off.id, noProber);
    expect(rows().filter((row) => row.deletedAt)).toHaveLength(0);

    const many = join(tree.base, "many");
    for (let n = 0; n < 30; n++) { mkdirSync(join(many, `d${n}`), { recursive: true }); writeFileSync(join(many, `d${n}`, `Film ${n} (2020).mp4`), "x"); }
    const big = addRoot(many, ["film"]);
    await scanRoot(big.id, noProber);
    for (let n = 0; n < 25; n++) unlinkSync(join(many, `d${n}`, `Film ${n} (2020).mp4`));
    for (let i = 0; i < 3; i++) expect((await scanRoot(big.id, noProber)).guards).toContain("mass_missing");
    expect(rows().filter((row) => row.locRootId === big.id && row.deletedAt)).toHaveLength(0);
  });

  test("a path a person deleted stays gone", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    await scanRoot(root.id, noProber);
    const gone = byPath("Garden Road.mkv");
    const { removeItem } = await import("@/lib/media/items");
    removeItem(gone.id);
    await scanRoot(root.id, { ...noProber, force: true });
    expect(byPath("Garden Road.mkv").deletedAt).not.toBeNull();
    expect(rows().filter((row) => row.locPath === "Garden Road.mkv")).toHaveLength(1);
  });
});

describe("stream metadata through the prober", () => {
  const fake = (calls: string[]): Prober => ({
    async probe(path): Promise<ProbeResult | "unavailable" | null> {
      calls.push(path);
      if (path.endsWith("Garden Road.mkv")) return { durationS: 5400, width: 1920, height: 1080, videoCodec: "hevc", audioCodec: "aac", container: "matroska", hasVideo: true, hasAudio: true, chapters: [{ start_s: 0, title: "Start" }] };
      return { durationS: 120, width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac", container: "mp4", hasVideo: true, hasAudio: true, chapters: [] };
    },
  });

  test("probed facts fill duration, size in pixels, codecs and playable (original or transcode)", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    const calls: string[] = [];
    const summary = await scanRoot(root.id, { prober: fake(calls), pruneGraceMs: 0 });
    expect(summary.probed).toBe(2);
    expect(itemFromRow(byPath("Garden Road.mkv"))).toMatchObject({ playable: "transcode", duration_s: 5400, width: 1920, height: 1080, video_codec: "hevc", chapters: [{ start_s: 0, title: "Start", source: "embedded" }] });
    expect(itemFromRow(byPath("Moon Rivets (2021).mp4"))).toMatchObject({ playable: "original", duration_s: 120 });
    // Probed once: a second scan asks nothing.
    calls.length = 0;
    await scanRoot(root.id, { prober: fake(calls), pruneGraceMs: 0 });
    expect(calls).toEqual([]);
  });

  test("an unreachable Stack never fails the scan: items are made from names with playable unknown and probed later", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    let up = false;
    const flaky: Prober = { probe: async () => (up ? { durationS: 90, width: 640, height: 360, videoCodec: "h264", audioCodec: "aac", container: "mp4", hasVideo: true, hasAudio: true, chapters: [] } : "unavailable") };
    const first = await scanRoot(root.id, { prober: flaky, pruneGraceMs: 0 });
    expect(first).toMatchObject({ status: "ok", added: 2, probed: 0 });
    expect(rows().every((row) => row.playable === "unknown")).toBe(true);
    up = true;
    const second = await scanRoot(root.id, { prober: flaky, pruneGraceMs: 0 });
    expect(second.probed).toBe(2);
    expect(rows().map((row) => [row.title, row.playable]).sort()).toEqual([["Garden Road", "transcode"], ["Moon Rivets", "original"]]); // an mkv container needs a transcode
  });

  test("a file the prober cannot read is marked and not asked about again until it changes", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    let asked = 0;
    const broken: Prober = { probe: async () => { asked++; return null; } };
    await scanRoot(root.id, { prober: broken, pruneGraceMs: 0 });
    await scanRoot(root.id, { prober: broken, pruneGraceMs: 0 });
    expect(asked).toBe(2);
  });
});

describe("coalescing and duplicates", () => {
  test("a scan asked for while one runs joins it: two requests, one running scan, one extra pass at most", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.films, ["film"]);
    const a = scanRoot(root.id, noProber);
    expect(isScanning(root.id)).toBe(true);
    const b = scanRoot(root.id, noProber);
    expect(b).toBe(a);
    await a;
    expect(isScanning(root.id)).toBe(false);
    expect(rows()).toHaveLength(2);
  });

  test("the duplicate finder reports the same size, length and title across roots, and changes nothing", async () => {
    const tree = buildMediaTree();
    const other = join(tree.base, "films2");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "Garden Road.mkv"), "film two"); // same size and title as films/Garden Road.mkv
    const a = addRoot(tree.films, ["film"]);
    const b = addRoot(other, ["film"]);
    await scanRoot(a.id, noProber);
    await scanRoot(b.id, noProber);
    const groups = findDuplicates();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((item) => item.location)).toHaveLength(2);
    expect(rows().filter((row) => row.deletedAt)).toHaveLength(0);
  });
});
