// A fixture media library for the scan and route tests: every kind the scanner knows, built in a temp folder from tiny real files
// (tests/fixtures/media: tagged audio, an EPUB with a cover, a PDF) and empty stand-ins for video, which the scanner reads by name.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withItunesAdvisory } from "./mp4Advisory";

const FIXTURES = join(import.meta.dir, "../fixtures/media");

function put(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
function copy(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(FIXTURES, from), to);
}

export interface MediaTree {
  base: string;
  videos: string;
  shows: string;
  films: string;
  music: string;
  reading: string;
}

/** `base/{videos,shows,films,music,reading}`: five roots that do not overlap. Video files hold placeholder bytes. */
export function buildMediaTree(): MediaTree {
  const base = mkdtempSync(join(tmpdir(), "maipai-media-tree-"));
  const videos = join(base, "videos");
  const shows = join(base, "shows");
  const films = join(base, "films");
  const music = join(base, "music");
  const reading = join(base, "reading");
  // Videos: a channel folder with ids in the names, and a home video.
  put(join(videos, "Bramble Workshop", "Building a birdhouse [bw-001].mp4"), "video one");
  put(join(videos, "Bramble Workshop", "Fixing a squeaky door [bw-002].mp4"), "video two");
  put(join(videos, "Home videos", "Sprout at the beach.mp4"), "video three");
  // Shows: two seasons and a poster.
  put(join(shows, "Juniper Bay", "poster.jpg"), "poster");
  for (const [season, episode, title] of [[1, 1, "Pilot"], [1, 2, "The Lighthouse"], [2, 1, "New Season"]] as const) {
    put(join(shows, "Juniper Bay", `Season ${season}`, `Juniper Bay S0${season}E0${episode} - ${title}.mp4`), `episode ${season}-${episode}`);
  }
  // Films: one with a sidecar poster and an NFO, one with no year.
  put(join(films, "Moon Rivets (2021).mp4"), "film one");
  put(join(films, "Moon Rivets (2021).jpg"), "film poster");
  put(join(films, "Moon Rivets (2021).nfo"), "<movie><title>Moon Rivets</title><year>2021</year><plot>A small robot repairs the moon.</plot><genre>Family</genre></movie>");
  put(join(films, "Garden Road.mkv"), "film two");
  // Music: a tagged album with a cover file, and an explicit single.
  copy("tagged-cover.mp3", join(music, "The Marlows", "Tempo", "01 Morning Light.mp3"));
  put(join(music, "The Marlows", "Tempo", "cover.jpg"), "album art");
  mkdirSync(join(music, "Clover", "Singles"), { recursive: true });
  writeFileSync(join(music, "Clover", "Singles", "01 Loud Song.m4a"), withItunesAdvisory(new Uint8Array(readFileSync(join(FIXTURES, "plain.m4a"))), 1));
  // Reading: an m4b with chapters, an EPUB of the same title beside it, a folder of numbered mp3 parts, a PDF.
  copy("book.m4b", join(reading, "Iris Quill", "The Clockwork Garden.m4b"));
  copy("book-cover.epub", join(reading, "Iris Quill", "The Clockwork Garden.epub"));
  copy("guide.pdf", join(reading, "Iris Quill", "Moon Rivets Field Guide.pdf"));
  for (const n of [1, 2, 3]) copy(`part${n}.mp3`, join(reading, "Iris Quill", "Moon Rivets", `0${n} Part ${n}.mp3`));
  return { base, videos, shows, films, music, reading };
}
