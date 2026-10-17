// LIKENESS-01: the person's own side of "pictures, videos and styles that look like me". The two switches themselves are
// settings (likeness.adults, likeness.adult_content) written through the settings routes, where only the person can
// change them. This file serves what sits beside them on the person's own Settings, Pictures and videos page: where they
// stand, their dated history, and the "Likeness use" log (who made what that looks like them, when). Only the person reads
// their own; an admin does not (rule 6a: no activity next to a person for anyone else). It also lists the household's
// adults for the pickers ("Who does this style look like?", "Who is in this photo?").
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { consentHistory, consentState, householdAdults, subjectEligibility } from "@/lib/likeness/consent";
import { likenessUseLog } from "@/lib/likeness/uses";
import { pictureDenial } from "@/lib/pictures/policy";
import { speakerAgeBand } from "@/lib/ageBand";

export const likenessRoutes = apiRouter();

const MeSchema = z.object({
  eligible: z.boolean().describe("Only an adult has these switches; a child or a teen is never the subject of anything."),
  adults: z.boolean(),
  adult_content: z.boolean(),
  history: z.array(z.object({ id: z.string(), option: z.enum(["adults", "adult_content"]), state: z.enum(["on", "off"]), changed_at: z.string() })),
  uses: z.array(z.object({ id: z.string(), who: z.string(), medium: z.enum(["picture", "video"]), way: z.enum(["style", "photo"]), adult_content: z.boolean(), used_at: z.string(), line: z.string() })),
});
const meRoute = createRoute({
  method: "get", path: "/me", tags: ["Likeness"], summary: "Where the signed-in person stands on pictures, videos and styles that look like them, their history and the use log", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: MeSchema } }, description: "Only the person's own." }, ...errorResponses({ 401: "Not signed in" }) },
});
likenessRoutes.openapi(meRoute, (c) => {
  const actor = c.get("person");
  if (!subjectEligibility(actor.id).ok) return c.json({ eligible: false, adults: false, adult_content: false, history: [], uses: [] }, 200);
  const consent = consentState(actor.id);
  return c.json({ eligible: true, adults: consent.adults, adult_content: consent.adultContent, history: consentHistory(actor.id), uses: likenessUseLog(actor.id) }, 200);
});

const adultsRoute = createRoute({
  method: "get", path: "/adults", tags: ["Likeness"], summary: "The household's adults, for the pickers (who a style looks like, who is in a photo)", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ adults: z.array(z.object({ id: z.string(), name: z.string(), self: z.boolean(), agreed: z.boolean().describe("Whether they have agreed to pictures, videos and styles that look like them (always true for the person asking, about themselves).") })) }) } }, description: "Adults only." }, ...errorResponses({ 401: "Not signed in", 403: "Only an adult can use these pickers" }) },
});
likenessRoutes.openapi(adultsRoute, (c) => {
  const actor = c.get("person");
  if (actor.role === "guest" || speakerAgeBand(actor, new Date()) !== "adult" || pictureDenial({ actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false }) === "minor") {
    return c.json({ error: "Only an adult can choose a person for a picture, a video or a style.", code: "adults_only" }, 403) as never;
  }
  return c.json({ adults: householdAdults().map((adult) => ({ ...adult, self: adult.id === actor.id, agreed: adult.id === actor.id || consentState(adult.id).adults })) }, 200);
});
