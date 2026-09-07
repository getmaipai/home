import { assertEquals } from "jsr:@std/assert@1";
import { summarizeHeadlines } from "./handler.ts";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>NPR News</title>
<item><title><![CDATA[First real headline]]></title></item>
<item><title><![CDATA[Second real headline]]></title></item>
<item><title><![CDATA[Third real headline]]></title></item>
<item><title><![CDATA[Fourth headline, past the cap]]></title></item>
</channel></rss>`;

Deno.test("reads the top headlines from the item titles, not the channel's own title", () => {
  const result = summarizeHeadlines(SAMPLE_RSS);
  assertEquals(result.text, "Top headlines: First real headline. Second real headline. Third real headline.");
});

Deno.test("respects a smaller count", () => {
  const result = summarizeHeadlines(SAMPLE_RSS, 1);
  assertEquals(result.text, "Top headlines: First real headline.");
});

Deno.test("decodes XML entities and unwraps CDATA", () => {
  const xml = `<rss><channel><item><title>Cats &amp; Dogs: It&#39;s complicated</title></item></channel></rss>`;
  const result = summarizeHeadlines(xml);
  assertEquals(result.text, "Top headlines: Cats & Dogs: It's complicated.");
});

Deno.test("reads a feed with no items as not found, not a crash", () => {
  const result = summarizeHeadlines(`<rss><channel><title>NPR News</title></channel></rss>`);
  assertEquals(result.text, "I couldn't find any news headlines right now.");
});

Deno.test("reads a malformed (non-string) response as not found, not a throw", () => {
  const result = summarizeHeadlines(null);
  assertEquals(result.text, "I couldn't find any news headlines right now.");
});

Deno.test("reads an empty string as not found", () => {
  const result = summarizeHeadlines("");
  assertEquals(result.text, "I couldn't find any news headlines right now.");
});
