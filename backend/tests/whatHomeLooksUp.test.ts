import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR } from "@/lib/paths";

const ROOT = join(import.meta.dir, "../..");
const PAGE = join(ROOT, "docs/user/what-home-looks-up.md");
const README = join(ROOT, "docs/user/README.md");

const SERVICE_NAMES: Record<string, string> = {
  "wikipedia": "Wikipedia",
  "loc": "Library of Congress",
  "osm": "OpenStreetMap Nominatim",
  "frankfurter": "Frankfurter",
  "feed-feeds-bbci-co-uk": "BBC",
  "feed-www-snexplores-org": "Science News Explores",
  "feed-www-nasa-gov": "NASA",
  "feed-feeds-npr-org": "NPR",
  "feed-www-pbs-org": "PBS",
  "feed-www-theguardian-com": "The Guardian",
  "feed-www-cbc-ca": "CBC News",
  "feed-www-si-com": "Sports Illustrated",
  "feed-www-popsci-com": "Popular Science",
  "feed-variety-com": "Variety",
  "feed-www-timeforkids-com": "TIME for Kids",
  "feed-grist-org": "Grist",
  "icanhazdadjoke": "icanhazdadjoke.com",
  "wikidata": "Wikidata",
  "musicbrainz": "MusicBrainz",
  "npr-rss": "NPR",
  "story-picture": "picture server",
  "story-text": "publisher's page",
  "story-archive": "Internet Archive",
  "picture-hosts": "picture sites",
  "searxng": "SearXNG",
  "mlb-statsapi": "MLB",
  "opentdb": "Open Trivia Database",
  "open-meteo": "Open-Meteo",
  "page": "web pages",
  "wikimedia-live": "Wikipedia",
  "wiktionary-live": "Wiktionary",
  "wayback": "Wayback Machine",
};

describe("What Home looks up page", () => {
  test("exists and is linked from the user guide", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("# What Home looks up for you");
    expect(readFileSync(README, "utf8")).toContain("(what-home-looks-up.md)");
  });

  test("names every bundled package data source", () => {
    const page = readFileSync(PAGE, "utf8");
    for (const packageId of readdirSync(PACKAGES_DIR)) {
      let manifest: { data_sources?: Array<{ id: string }> };
      try {
        manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, packageId, "manifest.json"), "utf8"));
      } catch {
        continue;
      }
      for (const source of manifest.data_sources ?? []) {
        const name = SERVICE_NAMES[source.id];
        expect(name, `Add ${packageId}:${source.id} to docs/user/what-home-looks-up.md`).toBeDefined();
        expect(page.toLowerCase(), `Add ${packageId}:${source.id} to docs/user/what-home-looks-up.md`).toContain(name!.toLowerCase());
      }
    }
  });
});
