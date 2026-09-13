import { assertEquals } from "jsr:@std/assert@1";
import { composeReply, handleMedia, parseTitleAndYear, pickCandidate, shapeMediaResult } from "./handler.ts";

// Recorded live, 2026-09-13, against the real Wikidata and Wikipedia
// REST APIs (getmaipai/.github's testing standard: fixtures, not a live
// network call, in every per-commit test).

const COBRA_SEARCH = {
  search: [
    { id: "Q56986706", description: "1986 video game" },
    { id: "Q1104726", description: "American musical group" },
    { id: "Q637290", description: "1986 film by George P. Cosmatos" },
  ],
};
const COBRA_ENTITY = {
  entities: {
    Q637290: {
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: "Q11424" } } } }],
        P57: [{ mainsnak: { datavalue: { value: { id: "Q504722" } } } }],
        P161: [
          { mainsnak: { datavalue: { value: { id: "Q40026" } } } },
          { mainsnak: { datavalue: { value: { id: "Q154519" } } } },
          { mainsnak: { datavalue: { value: { id: "Q891531" } } } },
          { mainsnak: { datavalue: { value: { id: "Q506958" } } } },
        ],
        P2047: [{ mainsnak: { datavalue: { value: { amount: "+83" } } } }],
        P577: [
          { mainsnak: { datavalue: { value: { time: "+1986-10-02T00:00:00Z" } } } },
          { mainsnak: { datavalue: { value: { time: "+1986-01-01T00:00:00Z" } } } },
          { mainsnak: { datavalue: { value: { time: "+2026-08-13T00:00:00Z" } } } },
        ],
      },
      sitelinks: { enwiki: { title: "Cobra (1986 film)" } },
    },
  },
};
const COBRA_LABELS = {
  entities: {
    Q637290: { labels: { en: { value: "Cobra" } } },
    Q504722: { labels: { en: { value: "George P. Cosmatos" } } },
    Q40026: { labels: { en: { value: "Sylvester Stallone" } } },
    Q154519: { labels: { en: { value: "Brigitte Nielsen" } } },
    Q891531: { labels: { en: { value: "Reni Santoni" } } },
  },
};
const COBRA_SUMMARY = {
  title: "Cobra (1986 film)",
  type: "standard",
  extract: "Cobra is a 1986 American action film directed by George P. Cosmatos and written by Sylvester Stallone, who stars in the title role.",
};

const GODFATHER_ENTITY = {
  entities: {
    Q47703: {
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: "Q11424" } } } }],
        P57: [{ mainsnak: { datavalue: { value: { id: "Q56094" } } } }],
        P161: [
          { mainsnak: { datavalue: { value: { id: "Q34012" } } } },
          { mainsnak: { datavalue: { value: { id: "Q41163" } } } },
          { mainsnak: { datavalue: { value: { id: "Q95043" } } } },
        ],
        P2047: [{ mainsnak: { datavalue: { value: { amount: "+175" } } } }],
        P577: [{ mainsnak: { datavalue: { value: { time: "+1972-03-15T00:00:00Z" } } } }],
        P1657: [{ mainsnak: { datavalue: { value: { id: "Q18665344" } } } }],
      },
      sitelinks: { enwiki: { title: "The Godfather" } },
    },
  },
};
const GODFATHER_LABELS = {
  entities: {
    Q47703: { labels: { en: { value: "The Godfather" } } },
    Q56094: { labels: { en: { value: "Francis Ford Coppola" } } },
    Q34012: { labels: { en: { value: "Marlon Brando" } } },
    Q41163: { labels: { en: { value: "Al Pacino" } } },
    Q95043: { labels: { en: { value: "James Caan" } } },
    Q18665344: { labels: { en: { value: "R" } } },
  },
};

const BREAKING_BAD_SEARCH = {
  search: [
    { id: "Q74123707", description: "2019 video game" },
    { id: "Q1079", description: "American crime drama television series (2008–2013)" },
  ],
};
const BREAKING_BAD_ENTITY = {
  entities: {
    Q1079: {
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: "Q5398426" } } } }],
        P57: [{ mainsnak: { datavalue: { value: { id: "Q4500" } } } }],
        P161: [
          { mainsnak: { datavalue: { value: { id: "Q271050" } } } },
          { mainsnak: { datavalue: { value: { id: "Q302491" } } } },
          { mainsnak: { datavalue: { value: { id: "Q432385" } } } },
        ],
      },
      sitelinks: { enwiki: { title: "Breaking Bad" } },
    },
  },
};
const BREAKING_BAD_LABELS = {
  entities: {
    Q1079: { labels: { en: { value: "Breaking Bad" } } },
    Q4500: { labels: { en: { value: "Vince Gilligan" } } },
    Q271050: { labels: { en: { value: "Anna Gunn" } } },
    Q302491: { labels: { en: { value: "Aaron Paul" } } },
    Q432385: { labels: { en: { value: "Dean Norris" } } },
  },
};
const BREAKING_BAD_SUMMARY = {
  title: "Breaking Bad",
  type: "standard",
  extract: "Breaking Bad is an American neo-Western crime drama television series created by Vince Gilligan for AMC.",
};

/** A fake `sendRequest` that answers each call in `hostFetch()`'s own
 * call order with the next queued response, the same "one MCP round-trip
 * per real network call, all faked" shape knowledge/handler_test.ts uses
 * for its own single-call case. */
function queuedSendRequest(responses: unknown[]) {
  let i = 0;
  return () => {
    const value = responses[i];
    i++;
    return Promise.resolve({ value });
  };
}

Deno.test("parseTitleAndYear splits a trailing year, bare or parenthesized", () => {
  assertEquals(parseTitleAndYear("Cobra"), { title: "Cobra", year: undefined });
  assertEquals(parseTitleAndYear("Cobra 1986"), { title: "Cobra", year: "1986" });
  assertEquals(parseTitleAndYear("Cobra (1986)"), { title: "Cobra", year: "1986" });
});

Deno.test("parseTitleAndYear leaves a title that IS a year-shaped string alone", () => {
  assertEquals(parseTitleAndYear("1984"), { title: "1984", year: undefined });
});

Deno.test("pickCandidate skips non-film, non-TV results and picks the film", () => {
  const candidate = pickCandidate(COBRA_SEARCH.search, undefined);
  assertEquals(candidate, { id: "Q637290", kind: "film" });
});

Deno.test("pickCandidate prefers the description matching a given year", () => {
  const results = [
    { id: "Q1", description: "1972 film by someone" },
    { id: "Q2", description: "1990 film remake" },
  ];
  assertEquals(pickCandidate(results, "1990"), { id: "Q2", kind: "film" });
});

Deno.test("pickCandidate recognizes a television series description", () => {
  const candidate = pickCandidate(BREAKING_BAD_SEARCH.search, undefined);
  assertEquals(candidate, { id: "Q1079", kind: "tv" });
});

Deno.test("pickCandidate returns null when nothing in the results is a film or TV show", () => {
  assertEquals(pickCandidate([{ id: "Q1", description: "roller coaster" }], undefined), null);
});

Deno.test("shapeMediaResult picks the earliest release year, not the first or last claim", () => {
  const result = shapeMediaResult(
    "Cobra (1986 film)",
    "film",
    COBRA_ENTITY.entities.Q637290,
    { Q504722: "George P. Cosmatos", Q40026: "Sylvester Stallone", Q154519: "Brigitte Nielsen", Q891531: "Reni Santoni" },
    null,
  );
  assertEquals(result.year, 1986);
  assertEquals(result.director, "George P. Cosmatos");
  assertEquals(result.cast, ["Sylvester Stallone", "Brigitte Nielsen", "Reni Santoni"]);
  assertEquals(result.runtime_min, 83);
  assertEquals(result.rating, null);
});

Deno.test("shapeMediaResult on a TV series leaves runtime, rating and year null rather than guessing", () => {
  const result = shapeMediaResult("Breaking Bad", "tv", BREAKING_BAD_ENTITY.entities.Q1079, {
    Q4500: "Vince Gilligan",
    Q271050: "Anna Gunn",
    Q302491: "Aaron Paul",
    Q432385: "Dean Norris",
  }, "Breaking Bad is an American neo-Western crime drama television series.");
  assertEquals(result.year, null);
  assertEquals(result.runtime_min, null);
  assertEquals(result.rating, null);
  assertEquals(result.director, "Vince Gilligan");
  assertEquals(result.cast, ["Anna Gunn", "Aaron Paul", "Dean Norris"]);
});

Deno.test("composeReply joins only the fields that are actually present", () => {
  const full = composeReply({ title: "Cobra", year: 1986, kind: "film", director: "George P. Cosmatos", cast: [], runtime_min: 83, rating: "R", synopsis: null, source: "wikidata" });
  assertEquals(full.text, "Cobra (1986), directed by George P. Cosmatos, 83 minutes, rated R.");

  const noRating = composeReply({ title: "Cobra", year: 1986, kind: "film", director: "George P. Cosmatos", cast: [], runtime_min: 83, rating: null, synopsis: null, source: "wikidata" });
  assertEquals(noRating.text, "Cobra (1986), directed by George P. Cosmatos, 83 minutes.");

  const seriesOnly = composeReply({ title: "Breaking Bad", year: null, kind: "tv", director: "Vince Gilligan", cast: [], runtime_min: null, rating: null, synopsis: null, source: "wikidata" });
  assertEquals(seriesOnly.text, "Breaking Bad, directed by Vince Gilligan.");
});

Deno.test("handleMedia answers a film end to end from recorded Wikidata and Wikipedia fixtures (Cobra)", async () => {
  const result = await handleMedia(
    { title: "Cobra" },
    { sendRequest: queuedSendRequest([COBRA_SEARCH, COBRA_ENTITY, COBRA_LABELS, COBRA_SUMMARY]) },
  );
  const parsed = JSON.parse(result.content[0].text);
  assertEquals(parsed.reply.text, "Cobra (1986), directed by George P. Cosmatos, 83 minutes.");
  assertEquals(parsed.result.cast, ["Sylvester Stallone", "Brigitte Nielsen", "Reni Santoni"]);
  assertEquals(parsed.result.synopsis, COBRA_SUMMARY.extract);
});

Deno.test("handleMedia answers a film with a rating end to end (The Godfather)", async () => {
  const result = await handleMedia(
    { title: "The Godfather" },
    {
      sendRequest: queuedSendRequest([
        { search: [{ id: "Q47703", description: "1972 American epic gangster drama film directed by Francis Ford Coppola" }] },
        GODFATHER_ENTITY,
        GODFATHER_LABELS,
        { title: "The Godfather", type: "standard", extract: "The Godfather is a 1972 American epic gangster film directed by Francis Ford Coppola." },
      ]),
    },
  );
  const parsed = JSON.parse(result.content[0].text);
  assertEquals(parsed.reply.text, "The Godfather (1972), directed by Francis Ford Coppola, 175 minutes, rated R.");
});

Deno.test("handleMedia answers a TV show end to end, with no runtime or rating claimed (Breaking Bad)", async () => {
  const result = await handleMedia(
    { title: "Breaking Bad" },
    { sendRequest: queuedSendRequest([BREAKING_BAD_SEARCH, BREAKING_BAD_ENTITY, BREAKING_BAD_LABELS, BREAKING_BAD_SUMMARY]) },
  );
  const parsed = JSON.parse(result.content[0].text);
  assertEquals(parsed.reply.text, "Breaking Bad, directed by Vince Gilligan.");
  assertEquals(parsed.result.kind, "tv");
});

Deno.test("handleMedia reports the typed not_found when nothing in the search is a film or TV show (#92's shape)", async () => {
  const result = await handleMedia(
    { title: "Xyzzyplugh12345" },
    { sendRequest: queuedSendRequest([{ search: [] }]) },
  );
  assertEquals(JSON.parse(result.content[0].text), {
    error: { code: "not_found", message: "no film or TV match for Xyzzyplugh12345" },
  });
});

Deno.test("handleMedia passes through the host's own typed error code on a failed fetch", async () => {
  const err = Object.assign(new Error("network down"), { data: { code: "network_unreachable" } });
  const result = await handleMedia({ title: "Cobra" }, { sendRequest: () => Promise.reject(err) });
  assertEquals(JSON.parse(result.content[0].text).error.code, "network_unreachable");
});
