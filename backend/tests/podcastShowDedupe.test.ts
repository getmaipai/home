import { describe, expect, test } from "bun:test";
import { dedupePodcastShowRows } from "@/routes/podcastApp";

describe("Shows list without repeats", () => {
  test("shows made here with the same title and label collapse to the first; feeds stay apart by address", () => {
    const rows = [
      { id: "a", title: "Morning briefing", channel: "Made here" },
      { id: "b", title: "Morning briefing", channel: "Made here" },
      { id: "c", title: " morning briefing ", channel: "Made here" },
      { id: "d", title: "Morning briefing", channel: "Streams only" },
      { id: "e", title: "Up First", feed_url: "https://example.com/a.xml" },
      { id: "f", title: "Up First", feed_url: "https://example.com/b.xml" },
      { id: "g", title: "Up First", feed_url: "https://example.com/a.xml" },
    ];
    expect(dedupePodcastShowRows(rows).map((row) => row.id)).toEqual(["a", "d", "e", "f"]);
  });
});
