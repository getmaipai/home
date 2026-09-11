import { assertEquals } from "jsr:@std/assert@1";
import { handleKnowledge, summarizeWikipediaResponse } from "./handler.ts";

Deno.test("a failed lookup returns a typed error so the host chooses the fallback", async () => {
  const result = await handleKnowledge({ topic: "Seattle" }, {
    sendRequest: () => Promise.reject(new Error("fetch failed")),
  });
  assertEquals(JSON.parse(result.content[0].text), {
    error: { code: "network_unreachable", message: "fetch failed" },
  });
});

Deno.test("a real Wikipedia summary shape formats as name: extract", () => {
  const result = summarizeWikipediaResponse("Seattle", {
    title: "Seattle",
    extract: "Seattle is a seaport city on the West Coast of the United States.",
    type: "standard",
  });
  assertEquals(result.text, "Seattle: Seattle is a seaport city on the West Coast of the United States.");
});

Deno.test("a disambiguation page reads as not found, not a wrong answer", () => {
  const result = summarizeWikipediaResponse("Mercury", { title: "Mercury", extract: "may refer to:", type: "disambiguation" });
  assertEquals(result.text, "I couldn't find a clear answer about Mercury.");
});

Deno.test("no extract at all (a 404, an empty body) reads as not found", () => {
  const result = summarizeWikipediaResponse("Xyzzyplugh", null);
  assertEquals(result.text, "I couldn't find a clear answer about Xyzzyplugh.");
});
