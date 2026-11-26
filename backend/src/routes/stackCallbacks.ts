// STACK-LORAS-01 slice 4: the one door the Stack knocks on. When someone lowers an adult-only style to all-ages, the Stack's PATCH route carries Home's fresh
// single-use adult-lock ticket and asks Home (here, with the paired token) to use it up. Home already checked the person, session and style when it forwarded
// the request (`peekTicket`); this only finishes it. No session: the paired key is the credential, and it is never the network. A wrong or missing key is 401, and
// an unknown, expired, used or other-style ticket answers `{ ok: false }` (the same answer for each, so nothing is learned from it).
import { createRoute, z } from "@hono/zod-openapi";
import { timingSafeEqual } from "node:crypto";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { consumeTicketForStack } from "@/lib/adultLock";
import { homeViewToken } from "@/lib/stack/homeViewToken";

export const stackCallbackRoutes = apiRouter();
const HOME_TOKEN_HEADER = "x-maipai-home-token";

export async function pairedTokenMatches(presented: string | undefined): Promise<boolean> {
  const held = await homeViewToken();
  if (!presented || !held) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(held);
  return a.length === b.length && timingSafeEqual(a, b);
}

const consumeRoute = createRoute({
  method: "post", path: "/adult-ticket/consume", tags: ["Stack callbacks"], summary: "The Stack uses up an adult-lock ticket (paired token only)",
  request: { body: { content: { "application/json": { schema: z.object({ ticket: z.string().min(1).max(200), item: z.string().min(1).max(120) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "True once, for a live ticket made for this item." }, ...errorResponses({ 401: "The paired key is missing or wrong" }) },
});
stackCallbackRoutes.openapi(consumeRoute, async (c) => {
  if (!(await pairedTokenMatches(c.req.header(HOME_TOKEN_HEADER)))) return c.json({ error: "That key is not accepted.", code: "bad_key" }, 401) as never;
  const { ticket, item } = c.req.valid("json");
  return c.json({ ok: consumeTicketForStack(ticket, item) }, 200);
});
