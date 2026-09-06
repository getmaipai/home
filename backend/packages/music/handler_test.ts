import { assertEquals } from "jsr:@std/assert@1";
import { summarizeArtist } from "./handler.ts";

Deno.test("describes a band, formed year and country", () => {
  const data = { artists: [{ name: "Radiohead", type: "Group", area: { name: "United Kingdom" }, "life-span": { begin: "1991", ended: null } }] };
  const result = summarizeArtist(data, "radiohead");
  assertEquals(result.text, "Radiohead is a band from United Kingdom, formed in 1991.");
});

Deno.test("describes a solo artist as born, not formed", () => {
  const data = { artists: [{ name: "Adele", type: "Person", area: { name: "United Kingdom" }, "life-span": { begin: "1988", ended: null } }] };
  const result = summarizeArtist(data, "adele");
  assertEquals(result.text, "Adele is a solo artist from United Kingdom, born in 1988.");
});

Deno.test("mentions a disbanded group's end year", () => {
  const data = { artists: [{ name: "The Beatles", type: "Group", area: { name: "United Kingdom" }, "life-span": { begin: "1960", ended: "1970" } }] };
  const result = summarizeArtist(data, "the beatles");
  assertEquals(result.text, "The Beatles is a band from United Kingdom, formed in 1960. They disbanded in 1970.");
});

Deno.test("mentions a deceased solo artist's passing, not 'disbanded'", () => {
  const data = { artists: [{ name: "Prince", type: "Person", area: { name: "United States" }, "life-span": { begin: "1958", ended: "2016" } }] };
  const result = summarizeArtist(data, "prince");
  assertEquals(result.text, "Prince is a solo artist from United States, born in 1958. They passed away in 2016.");
});

Deno.test("still reports a name with no area or dates at all", () => {
  const data = { artists: [{ name: "Mystery Act" }] };
  const result = summarizeArtist(data, "mystery act");
  assertEquals(result.text, "Mystery Act is an artist.");
});

Deno.test("reports no match when the search returns no artists", () => {
  const result = summarizeArtist({ artists: [] }, "zzznotarealband");
  assertEquals(result.text, 'I couldn\'t find an artist named "zzznotarealband".');
});

Deno.test("reads a malformed (non-object) response as not found, not a throw", () => {
  const result = summarizeArtist(null, "radiohead");
  assertEquals(result.text, 'I couldn\'t find an artist named "radiohead".');
});

// The same class of gap code review found in almanac-holiday/onthisday:
// a first result that exists but has no usable `name` must read as not
// found, not interpolate "undefined."
Deno.test("reads a first result with a missing name as not found", () => {
  const result = summarizeArtist({ artists: [{ type: "Group" }] }, "radiohead");
  assertEquals(result.text, 'I couldn\'t find an artist named "radiohead".');
});
