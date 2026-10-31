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
  "feed-www-marketwatch-com": "MarketWatch",
  "feed-techcrunch-com": "TechCrunch",
  "feed-9to5mac-com": "9to5Mac",
  "feed-abcnews-go-com": "ABC News",
  "feed-daringfireball-net": "Daring Fireball",
  "feed-deadline-com": "Deadline",
  "feed-feeds-a-dj-com": "The Wall Street Journal",
  "feed-feeds-arstechnica-com": "Ars Technica",
  "feed-feeds-businessinsider-com": "Business Insider",
  "feed-feeds-macrumors-com": "MacRumors",
  "feed-feeds-nbcnews-com": "NBC News",
  "feed-feeds-skynews-com": "Sky News",
  "feed-fortune-com": "Fortune",
  "feed-gizmodo-com": "Gizmodo",
  "feed-mashable-com": "Mashable",
  "feed-moxie-foxnews-com": "Fox News",
  "feed-phys-org": "Phys.org",
  "feed-rss-dw-com": "Deutsche Welle",
  "feed-rss-nytimes-com": "The New York Times",
  "feed-search-cnbc-com": "CNBC",
  "feed-seekingalpha-com": "Seeking Alpha",
  "feed-sports-yahoo-com": "Yahoo Sports",
  "feed-www-aljazeera-com": "Al Jazeera",
  "feed-www-androidauthority-com": "Android Authority",
  "feed-www-cbsnews-com": "CBS News",
  "feed-www-cbssports-com": "CBS Sports",
  "feed-www-cnet-com": "CNET",
  "feed-www-economist-com": "The Economist",
  "feed-www-engadget-com": "Engadget",
  "feed-www-entrepreneur-com": "Entrepreneur",
  "feed-www-espn-com": "ESPN",
  "feed-www-fastcompany-com": "Fast Company",
  "feed-www-forbes-com": "Forbes",
  "feed-www-france24-com": "France 24",
  "feed-www-hollywoodreporter-com": "The Hollywood Reporter",
  "feed-www-inc-com": "Inc.",
  "feed-www-latimes-com": "Los Angeles Times",
  "feed-www-nature-com": "Nature",
  "feed-www-newscientist-com": "New Scientist",
  "feed-www-oregonlive-com": "The Oregonian",
  "feed-www-rollingstone-com": "Rolling Stone",
  "feed-www-sciencedaily-com": "ScienceDaily",
  "feed-www-smithsonianmag-com": "Smithsonian",
  "feed-www-space-com": "Space.com",
  "feed-www-startribune-com": "Star Tribune",
  "feed-www-technologyreview-com": "MIT Technology Review",
  "feed-www-techradar-com": "TechRadar",
  "feed-www-texastribune-org": "The Texas Tribune",
  "feed-www-theregister-com": "The Register",
  "feed-www-theverge-com": "The Verge",
  "feed-www-tomsguide-com": "Tom's Guide",
  "feed-www-wired-com": "Wired",
  "feed-www-zdnet-com": "ZDNet",
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
