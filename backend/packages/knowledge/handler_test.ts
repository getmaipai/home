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
  assertEquals(result?.text, "Seattle: Seattle is a seaport city on the West Coast of the United States.");
});

Deno.test("a disambiguation page is a miss (null), never a wrong answer", () => {
  const result = summarizeWikipediaResponse("Mercury", { title: "Mercury", extract: "may refer to:", type: "disambiguation" });
  assertEquals(result, null);
});

Deno.test("no extract at all (an empty body) is a miss (null)", () => {
  assertEquals(summarizeWikipediaResponse("Xyzzyplugh", null), null);
});

Deno.test("a miss is reported as the typed not_found, so the hub's turn engine hands the question to the model (#92)", async () => {
  const result = await handleKnowledge({ topic: "two plus two" }, {
    sendRequest: () => Promise.resolve({ value: { title: "2 + 2", type: "disambiguation", extract: "may refer to:" } }),
  });
  assertEquals(JSON.parse(result.content[0].text), { error: { code: "not_found", message: "no summary for two plus two" } });
});

Deno.test("the host's own typed code in the MCP error's data passes through: a 404 is not_found, not network_unreachable", async () => {
  const err = Object.assign(new Error("https://en.wikipedia.org/api/rest_v1/page/summary/x returned HTTP 404"), { data: { code: "not_found" } });
  const result = await handleKnowledge({ topic: "x" }, { sendRequest: () => Promise.reject(err) });
  assertEquals(JSON.parse(result.content[0].text).error.code, "not_found");
});
