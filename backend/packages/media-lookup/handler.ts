// Film and TV metadata: director, cast, runtime, rating, release year, and
// a plain-language synopsis, for a named title. Keyless, the same public
// APIs a person would use themselves: Wikidata's own API (structured
// facts) and Wikipedia's REST summary API (the story), both through
// host.fetch, never a direct Deno-side fetch (this process has no net
// permission at all; knowledge/handler.ts's own header explains why).
//
// Part of the conversation program (docs/plans/media-conversation-
// program-2026-09-13.md, home's own dev docs): step 1, "the media
// package," a typed evidence source a resolved media subject will route
// to deterministically once CHAT-13 lands. Until then, on its own, it
// answers today's fixed patterns (below) with one composed sentence -
// "until then the package's own sentence is the Tier 1 reply, as every
// package today" (the plan's own Rules section).
//
// No import from anywhere outside this directory, same constraint as
// knowledge/handler.ts: a Tier 1 package's Deno process can only read
// its own directory.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

interface WikidataSearchResult {
  id: string;
  description?: string;
}

interface WikidataSearchResponse {
  search?: WikidataSearchResult[];
}

interface WikidataSnak {
  datavalue?: { value: unknown };
}

interface WikidataClaim {
  mainsnak?: WikidataSnak;
}

interface WikidataEntity {
  claims?: Record<string, WikidataClaim[]>;
  sitelinks?: Record<string, { title?: string }>;
}

interface WikidataEntitiesResponse {
  entities?: Record<string, WikidataEntity>;
}

export interface MediaResult {
  title: string;
  year: number | null;
  kind: "film" | "tv";
  director: string | null;
  cast: string[];
  runtime_min: number | null;
  rating: string | null;
  synopsis: string | null;
  source: "wikidata";
}

/** A person typing or speaking a title sometimes tacks a release year onto
 * the end ("Cobra 1986", "Cobra (1986)") - split it off so the Wikidata
 * search below (an exact/prefix label match, not full text) gets a clean
 * title to search, and the year survives to disambiguate the results. A
 * title that is ENTIRELY a four-digit year-looking string (the 1984 film
 * literally called "1984") is left alone rather than stripped to nothing -
 * an empty search title can never match anything. */
export function parseTitleAndYear(raw: string): { title: string; year: string | undefined } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)\s*\(?((?:19|20)\d{2})\)?\s*$/);
  if (!match) return { title: trimmed, year: undefined };
  const title = match[1]!.trim();
  if (!title) return { title: trimmed, year: undefined };
  return { title, year: match[2] };
}

/** The first Wikidata search result whose own description reads as a film
 * or a TV series (never a video game, a song, a roller coaster - Wikidata
 * labels collide across every kind of thing, "Cobra" being five different
 * unrelated entries before the 1986 film even without a year given, live-
 * checked 2026-09-13), preferring one whose description also names the
 * given year when a year was given. Description text is what decides
 * `kind` too, reusing the same field rather than a second Wikidata call to
 * resolve `P31`'s own value. */
export function pickCandidate(results: WikidataSearchResult[], year: string | undefined): { id: string; kind: "film" | "tv" } | null {
  const media = results
    .map((r) => {
      const description = r.description ?? "";
      const kind: "film" | "tv" | null = /television series/i.test(description) ? "tv" : /\bfilm\b/i.test(description) ? "film" : null;
      return kind ? { id: r.id, kind, description } : null;
    })
    .filter((r): r is { id: string; kind: "film" | "tv"; description: string } => r !== null);
  if (media.length === 0) return null;
  const picked = (year ? media.find((r) => r.description.includes(year)) : undefined) ?? media[0]!;
  return { id: picked.id, kind: picked.kind };
}

function entityIdOf(claim: WikidataClaim | undefined): string | undefined {
  const value = claim?.mainsnak?.datavalue?.value as { id?: string } | undefined;
  return value?.id;
}

function quantityOf(claim: WikidataClaim | undefined): number | undefined {
  const value = claim?.mainsnak?.datavalue?.value as { amount?: string } | undefined;
  if (!value?.amount) return undefined;
  const n = Number(value.amount.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** The earliest year among every `P577` (publication date) claim, not
 * just the first: a title can carry a handful of release dates (region
 * premieres, a home-video reissue years later), and the original release
 * is the one worth calling "the year" - live-checked against a real film
 * whose own claims included an anomalous 2026 date decades after its
 * real 1986 release. */
function earliestYear(claims: WikidataClaim[] | undefined): number | undefined {
  const years = (claims ?? [])
    .map((c) => (c.mainsnak?.datavalue?.value as { time?: string } | undefined)?.time)
    .map((time) => (time ? Number(time.slice(1, 5)) : undefined))
    .filter((y): y is number => y !== undefined && Number.isFinite(y));
  return years.length > 0 ? Math.min(...years) : undefined;
}

async function hostFetch(
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
  url: string,
): Promise<unknown> {
  const result = await extra.sendRequest(
    { method: "host/fetch", params: { url } },
    z.object({ value: z.unknown() }),
  );
  return result.value;
}

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

/** Builds the typed `MediaResult` from a matched Wikidata entity plus the
 * label lookups for the entity-valued claims it references (director,
 * cast, rating are each a Wikidata item, not a plain string). Exported so
 * handler_test.ts can exercise the shaping logic directly against
 * recorded fixture entities, the same way knowledge/handler.ts's own
 * `summarizeWikipediaResponse` is tested without a live MCP round-trip. */
export function shapeMediaResult(
  title: string,
  kind: "film" | "tv",
  entity: WikidataEntity,
  labels: Record<string, string>,
  synopsis: string | null,
): MediaResult {
  const claims = entity.claims ?? {};
  const directorId = entityIdOf(claims.P57?.[0]);
  const castIds = (claims.P161 ?? []).slice(0, 3).map((c) => entityIdOf(c)).filter((id): id is string => id !== undefined);
  const ratingId = entityIdOf(claims.P1657?.[0]);
  return {
    title,
    year: earliestYear(claims.P577) ?? null,
    kind,
    director: directorId ? (labels[directorId] ?? null) : null,
    cast: castIds.map((id) => labels[id]).filter((name): name is string => name !== undefined),
    runtime_min: quantityOf(claims.P2047?.[0]) ?? null,
    rating: ratingId ? (labels[ratingId] ?? null) : null,
    synopsis,
    source: "wikidata",
  };
}

/** The one sentence the Tier 1 path speaks today (the plan's own Rules
 * section: "until then the package's own sentence is the Tier 1 reply,
 * as every package today") - every present field joined into one plain
 * sentence, a missing one simply left out rather than spoken as "unknown"
 * or "null". A future composer (CHAT-16) replaces this with a real
 * companion-voiced answer to whichever specific thing was actually
 * asked; this is the honest floor until then. */
export function composeReply(result: MediaResult): { text: string; speech: string } {
  const parts: string[] = [];
  const titleYear = result.year ? `${result.title} (${result.year})` : result.title;
  parts.push(titleYear);
  if (result.director) parts.push(`directed by ${result.director}`);
  if (result.runtime_min) parts.push(`${result.runtime_min} minutes`);
  if (result.rating) parts.push(`rated ${result.rating}`);
  const text = `${parts.join(", ")}.`;
  return { text, speech: text };
}

export async function handleMedia(
  { title: rawTitle }: { title: string },
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
) {
  try {
    const { title, year } = parseTitleAndYear(rawTitle);
    const searchUrl = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&type=item&format=json&limit=20`;
    const search = (await hostFetch(extra, searchUrl)) as WikidataSearchResponse;
    const candidate = pickCandidate(search.search ?? [], year);
    if (!candidate) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "not_found", message: `no film or TV match for ${title}` } }) }] };
    }

    const entityUrl = `${WIKIDATA_API}?action=wbgetentities&ids=${candidate.id}&props=claims%7Csitelinks&languages=en&format=json`;
    const entityResponse = (await hostFetch(extra, entityUrl)) as WikidataEntitiesResponse;
    const entity = entityResponse.entities?.[candidate.id];
    if (!entity) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "not_found", message: `no film or TV match for ${title}` } }) }] };
    }

    const claims = entity.claims ?? {};
    // The candidate's own id rides along in this same batch so its
    // display label (e.g. "Cobra") comes back with everyone else's - the
    // Wikipedia sitelink title below is a PAGE title, not a display name
    // (Wikipedia disambiguates same-named works with a parenthetical,
    // "Cobra (1986 film)", which read wrong stacked next to this
    // package's own "(year)" suffix in the reply - found by this
    // package's own tests, fixed here rather than in the reply
    // composer).
    const referencedIds = [candidate.id, entityIdOf(claims.P57?.[0]), ...(claims.P161 ?? []).slice(0, 3).map((c) => entityIdOf(c)), entityIdOf(claims.P1657?.[0])].filter((id): id is string => id !== undefined);
    let labels: Record<string, string> = {};
    if (referencedIds.length > 0) {
      const labelsUrl = `${WIKIDATA_API}?action=wbgetentities&ids=${referencedIds.join("|")}&props=labels&languages=en&format=json`;
      const labelsResponse = (await hostFetch(extra, labelsUrl)) as WikidataEntitiesResponse;
      labels = Object.fromEntries(
        Object.entries(labelsResponse.entities ?? {})
          .map(([id, e]) => [id, (e as unknown as { labels?: Record<string, { value?: string }> }).labels?.en?.value])
          .filter(([, name]) => name !== undefined) as [string, string][],
      );
    }

    const sitelinkTitle = entity.sitelinks?.enwiki?.title;
    let synopsis: string | null = null;
    if (sitelinkTitle) {
      try {
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sitelinkTitle)}`;
        const summary = (await hostFetch(extra, summaryUrl)) as { extract?: string; type?: string };
        if (summary.extract && summary.type !== "disambiguation") synopsis = summary.extract;
      } catch {
        // A synopsis fetch failing doesn't sink the whole lookup - the
        // typed fields from Wikidata already carry the vitals the
        // routing examples above ask for (runtime, director, cast,
        // rating), and `composeReply()` below never depends on it.
      }
    }

    const result = shapeMediaResult(labels[candidate.id] ?? title, candidate.kind, entity, labels, synopsis);
    const reply = composeReply(result);
    return { content: [{ type: "text" as const, text: JSON.stringify({ reply, actions: [], result }) }] };
  } catch (err) {
    const data = (err as { data?: { code?: unknown } }).data;
    const code = typeof data?.code === "string" ? data.code : "network_unreachable";
    const error = { code, message: err instanceof Error ? err.message : String(err) };
    return { content: [{ type: "text" as const, text: JSON.stringify({ error }) }] };
  }
}

if (import.meta.main) {
  const server = new McpServer({ name: "media-lookup", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: { title: z.string().min(1) } },
    handleMedia,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
