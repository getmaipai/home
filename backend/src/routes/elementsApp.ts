// ELEMENTS-HOME-03: the Elements app's one action, `POST /api/plugins/elements/actions/make` ("Make an element, from words").
import { apiRouter } from "@/lib/openapi";
import { jsonBody } from "@/lib/validation";
import { appRouteAllowed } from "@/lib/apps";
import { requireAuth } from "@/middleware/auth";
import { gateMediaApp } from "@/middleware/mediaAppGate";
import { getPictureJob } from "@/lib/pictures/jobs";
import { makeElementFromWords } from "@/lib/elementsMake";

export const elementsAppRoutes = apiRouter();
gateMediaApp(elementsAppRoutes, "elements", ["/actions/make"]);
elementsAppRoutes.post("/actions/make", requireAuth, async (c, next) => {
  const person = c.get("person");
  if (!appRouteAllowed(person, "elements", "actions", "make")) return next();
  const made = await makeElementFromWords(person, await jsonBody(c));
  return made.ok
    ? c.json({ ok: true as const, id: made.ids[0], ids: made.ids, state: getPictureJob(person, made.ids[0]!)?.state ?? "queued", notice: made.notice }, 200)
    : c.json({ error: made.error, code: made.code }, made.status as never);
});
