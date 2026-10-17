// MEDIA-LIB-01: one parser per kind, each tested on its own input. Tagged audio, the EPUB and the PDF are tiny real files in
// tests/fixtures/media; the iTunes advisory atom is written into a real m4a by tests/support/mp4Advisory.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTvName, seasonFolderNumber, findFolderArt } from "@/lib/media/parsers/tv";
import { parseFilmName, parseNfo, readNfoFor, filmNameHasYear } from "@/lib/media/parsers/film";
import { readAudioTags, readEmbeddedCover } from "@/lib/media/parsers/audioTags";
import { readEpubMeta, readEpubCover, parseOpf } from "@/lib/media/parsers/epub";
import { parsePdf, readPdfMeta } from "@/lib/media/parsers/pdf";
import { openZip } from "@/lib/media/parsers/zip";
import { bookPathHints } from "@/lib/media/ingest";
import { bandOkAtIngest } from "@/lib/media/band";
import { decidePlayable } from "@/lib/media/kinds";
import { probeResultFrom } from "@/lib/media/prober";
import { withItunesAdvisory } from "./support/mp4Advisory";

const fixture = (name: string) => join(import.meta.dir, "fixtures/media", name);
const scratch = () => mkdtempSync(join(tmpdir(), "maipai-media-parsers-"));

describe("TV names", () => {
  test("Show/Season N/Show SxxEyy - Title.ext", () => {
    expect(parseTvName("Juniper Bay/Season 1/Juniper Bay S01E02 - The Lighthouse.mp4")).toEqual({ series: "Juniper Bay", season: 1, episode: 2, title: "The Lighthouse" });
    expect(parseTvName("Juniper Bay/Season 12/Juniper Bay S12E103 - Finale.mkv")).toMatchObject({ season: 12, episode: 103 });
  });
  test("a file straight in the show folder, dotted release names, 1x02, double episodes and a missing title", () => {
    expect(parseTvName("Bramble Show/Bramble.Show.S02E05.720p.mkv")).toMatchObject({ series: "Bramble Show", season: 2, episode: 5, title: "Episode 5" });
    expect(parseTvName("Bramble Show/Season 1/Bramble Show 1x03 - Wood.mp4")).toMatchObject({ season: 1, episode: 3, title: "Wood" });
    expect(parseTvName("Bramble Show/Season 1/Bramble Show S01E01E02 - Two Parts.mp4")).toMatchObject({ episode: 1, title: "Two Parts" });
    expect(parseTvName("Specials/Bramble Show S00E01 - Behind.mp4")).toMatchObject({ season: 0, series: "Bramble Show" }); // a Specials folder is a season folder, so the file name names the show
  });
  test("the file name's prefix names the show when there is no show folder; a non-episode returns null", () => {
    expect(parseTvName("Juniper Bay S01E01 - Pilot.mp4")).toEqual({ series: "Juniper Bay", season: 1, episode: 1, title: "Pilot" });
    expect(parseTvName("Holiday video.mp4")).toBeNull();
    expect(parseTvName("S01E01.mp4")).toBeNull();
  });
  test("season folders and folder art", () => {
    expect(seasonFolderNumber("Season 3")).toBe(3);
    expect(seasonFolderNumber("Specials")).toBe(0);
    expect(seasonFolderNumber("Extras")).toBeNull();
    expect(findFolderArt(["Notes.txt", "Poster.JPG", "cover.png"])).toBe("Poster.JPG");
    expect(findFolderArt(["a.mp4"])).toBeNull();
  });
});

describe("film names and NFO", () => {
  test("Title (Year).ext and the other common forms", () => {
    expect(parseFilmName("Moon Rivets (2021).mp4")).toEqual({ title: "Moon Rivets", year: 2021 });
    expect(parseFilmName("Moon Rivets [2021].mkv")).toEqual({ title: "Moon Rivets", year: 2021 });
    expect(parseFilmName("Moon.Rivets.2021.1080p.mkv")).toEqual({ title: "Moon Rivets", year: 2021 });
    expect(parseFilmName("Films/Garden Road.mp4")).toEqual({ title: "Garden Road", year: null });
    expect(parseFilmName("Moon Rivets (2021)/movie.mp4").title).toBe("movie");
    expect(filmNameHasYear("a/Moon Rivets (2021).mp4")).toBe(true);
    expect(filmNameHasYear("a/Holiday.mp4")).toBe(false);
  });
  test("an NFO is read (title, year, plot, genre, runtime) and decoded; it is never written", () => {
    const nfo = parseNfo("<movie><title>Tom &amp; Jerry</title><year>1998</year><plot><![CDATA[A cat <b>and</b> a mouse.]]></plot><genre>Family</genre><runtime>95</runtime></movie>");
    expect(nfo).toEqual({ title: "Tom & Jerry", year: 1998, plot: "A cat and a mouse.", genre: "Family", runtimeS: 5700 });
    const dir = scratch();
    writeFileSync(join(dir, "Film (2020).mp4"), "x");
    expect(readNfoFor(join(dir, "Film (2020).mp4"))).toBeNull();
    writeFileSync(join(dir, "movie.nfo"), "<movie><title>From folder</title></movie>");
    expect(readNfoFor(join(dir, "Film (2020).mp4"))?.title).toBe("From folder");
    expect(parseNfo("not xml at all")).toMatchObject({ title: null, year: null, plot: null });
  });
});

describe("audio tags", () => {
  test("title, artist, album, track, disc, year, genre, duration, codec and embedded art from an mp3", async () => {
    const tags = await readAudioTags(fixture("tagged-cover.mp3"));
    expect(tags).toMatchObject({ title: "Morning Light", artist: "The Marlows", album: "Tempo", albumArtist: "The Marlows", trackNo: 1, discNo: 1, year: 2023, genre: "Indie", explicit: false, hasEmbeddedArt: true });
    expect(tags!.durationS).toBeCloseTo(2, 0);
    expect(tags!.codec).toContain("MPEG");
  });
  test("the iTunes advisory flag: rtng 1 and 4 are explicit, 2 and none are not, and an ID3 frame counts too", async () => {
    const m4a = new Uint8Array(readFileSync(fixture("plain.m4a")));
    const dir = scratch();
    const read = async (value: 0 | 1 | 2 | 4) => {
      const path = join(dir, `rtng-${value}.m4a`);
      writeFileSync(path, withItunesAdvisory(m4a, value));
      return (await readAudioTags(path))!.explicit;
    };
    expect(await read(1)).toBe(true);
    expect(await read(4)).toBe(true);
    expect(await read(2)).toBe(false);
    expect(await read(0)).toBe(false);
    expect((await readAudioTags(fixture("plain.m4a")))!.explicit).toBe(false);
    expect((await readAudioTags(fixture("advisory.mp3")))!.explicit).toBe(true);
  });
  test("m4b chapters become start seconds and titles", async () => {
    const tags = await readAudioTags(fixture("book.m4b"));
    expect(tags!.chapters).toEqual([{ start_s: 0, title: "Chapter 1" }, { start_s: 2, title: "Chapter 2" }, { start_s: 4, title: "Chapter 3" }]);
    expect(tags).toMatchObject({ composer: "Nadia Sage", genre: "Audiobook", album: "The Clockwork Garden" });
  });
  test("embedded cover art is read on demand; a file that is not audio gives null, not an error", async () => {
    const cover = await readEmbeddedCover(fixture("tagged-cover.mp3"));
    expect(cover!.mediaType).toBe("image/jpeg");
    expect(cover!.data.byteLength).toBeGreaterThan(100);
    expect(await readEmbeddedCover(fixture("plain.m4a"))).toBeNull();
    const dir = scratch();
    writeFileSync(join(dir, "broken.mp3"), "not audio");
    expect(await readAudioTags(join(dir, "broken.mp3"))).toBeNull();
  });
});

describe("EPUB", () => {
  test("title, author, series, description and the cover entry from the OPF", async () => {
    const meta = await readEpubMeta(fixture("book-cover.epub"));
    expect(meta).toMatchObject({ title: "The Clockwork Garden", author: "Iris Quill", series: "Garden Tales", seriesIndex: 1, language: "en", description: "A garden of brass and gears.", coverEntry: "OEBPS/cover.jpg", coverMediaType: "image/jpeg" });
    const cover = await readEpubCover(fixture("book-cover.epub"));
    expect(cover!.mediaType).toBe("image/jpeg");
    expect(cover!.data.byteLength).toBeGreaterThan(100);
  });
  test("an EPUB with no cover reads without one; Calibre series meta and several authors", async () => {
    expect((await readEpubMeta(fixture("book.epub")))!.coverEntry).toBeNull();
    expect(await readEpubCover(fixture("book.epub"))).toBeNull();
    const meta = parseOpf(
      '<package><metadata xmlns:dc="x"><dc:title>Gears &amp; Bees</dc:title><dc:creator>Iris Quill</dc:creator><dc:creator>Nadia Sage</dc:creator><dc:date>2019-05-01</dc:date><meta name="calibre:series" content="Hum"/><meta name="calibre:series_index" content="2.5"/><meta name="cover" content="img"/></metadata><manifest><item id="img" href="../images/c.png" media-type="image/png"/></manifest></package>',
      "OEBPS/content.opf",
    );
    expect(meta).toMatchObject({ title: "Gears & Bees", author: "Iris Quill, Nadia Sage", year: 2019, series: "Hum", seriesIndex: 2.5, coverEntry: "images/c.png" });
  });
  test("a file that is not a zip is null", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "x.epub"), "plain text, no zip here");
    expect(await readEpubMeta(join(dir, "x.epub"))).toBeNull();
    expect(await openZip(join(dir, "x.epub"))).toBeNull();
  });
});

describe("PDF", () => {
  test("title, author and page count", () => {
    expect(readPdfMeta(fixture("guide.pdf"))).toEqual({ title: "Moon Rivets Field Guide", author: "Iris Quill", pages: 2 });
  });
  test("escaped and hex titles; page leaves counted when there is no /Count; not a PDF is null", () => {
    expect(parsePdf("/Title (A \\(small\\) guide) /Author <FEFF00490072006900730020>").title).toBe("A (small) guide");
    expect(parsePdf("/Author <FEFF00490072006900730020>").author).toBe("Iris");
    expect(parsePdf("/Type /Page /Type /Page /Type /Pages").pages).toBe(2);
    expect(parsePdf("nothing").pages).toBeNull();
    const dir = scratch();
    writeFileSync(join(dir, "x.pdf"), "hello");
    expect(readPdfMeta(join(dir, "x.pdf"))).toBeNull();
  });
});

describe("audiobook paths", () => {
  test("Author/Series/Book gives a series from the folder above; Author/Book gives only an author", () => {
    expect(bookPathHints(["Iris Quill", "Garden Tales"])).toEqual({ author: "Iris Quill", series: "Garden Tales" });
    expect(bookPathHints(["Iris Quill"])).toEqual({ author: "Iris Quill", series: null });
    expect(bookPathHints([])).toEqual({ author: null, series: null });
  });
});

describe("band_ok at ingest and playable", () => {
  test("explicit is adult; clean words are child; the household's sexual words make it adult", () => {
    expect(bandOkAtIngest({ explicit: true, title: "Loud Song" })).toEqual({ band: "adult", advisorySource: "tag" });
    expect(bandOkAtIngest({ explicit: false, title: "Sprout at the beach", description: "A day by the sea." })).toEqual({ band: "child", advisorySource: "tag" });
    expect(bandOkAtIngest({ explicit: false, title: "Late night", description: "Explicit adult content, nsfw." })).toEqual({ band: "adult", advisorySource: "classifier" });
    expect(bandOkAtIngest({ explicit: false, title: "Fine", also: ["Hardcore porn"] }).band).toBe("adult");
  });
  test("playable: browsers play h264/aac in mp4 as is; hevc, mkv and odd audio need a transcode; no streams is none", () => {
    expect(decidePlayable({ ext: "mp4", hasVideo: true, hasAudio: true, videoCodec: "h264", audioCodec: "aac" })).toBe("original");
    expect(decidePlayable({ ext: "mp4", hasVideo: true, hasAudio: true, videoCodec: "hevc", audioCodec: "aac" })).toBe("transcode");
    expect(decidePlayable({ ext: "mkv", hasVideo: true, hasAudio: true, videoCodec: "h264", audioCodec: "aac" })).toBe("transcode");
    expect(decidePlayable({ ext: "mp3", hasVideo: false, hasAudio: true, videoCodec: null, audioCodec: "mp3" })).toBe("original");
    expect(decidePlayable({ ext: "wma", hasVideo: false, hasAudio: true, videoCodec: null, audioCodec: "wmav2" })).toBe("transcode");
    expect(decidePlayable({ ext: "bin", hasVideo: false, hasAudio: false, videoCodec: null, audioCodec: null })).toBe("none");
  });
  test("a Stack probe result is read in snake_case or camelCase; junk is null", () => {
    expect(probeResultFrom({ duration_s: 12.5, width: 640, height: 360, video_codec: "h264", audio_codec: "aac", chapters: [{ start_s: 5, title: "B" }, { start: 0, title: "A" }, { start: -1 }] })).toMatchObject({ durationS: 12.5, hasVideo: true, hasAudio: true, chapters: [{ start_s: 0, title: "A" }, { start_s: 5, title: "B" }] });
    expect(probeResultFrom({ durationS: 3, audioCodec: "mp3" })).toMatchObject({ hasVideo: false, hasAudio: true });
    expect(probeResultFrom(null)).toBeNull();
    expect(probeResultFrom({})).toBeNull();
  });
});
