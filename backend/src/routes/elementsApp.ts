// ELEMENTS-HOME-03: the Elements app's one action, `POST /api/plugins/elements/actions/make` ("Make an element, from words").
import { apiRouter } from "@/lib/openapi";
import { jsonBody } from "@/lib/validation";
import { appRouteAllowed } from "@/lib/apps";
import { requireAuth } from "@/middleware/auth";
import { gateMediaApp } from "@/middleware/mediaAppGate";
import { getPictureJob } from "@/lib/pictures/jobs";
import { makeElementFromWords } from "@/lib/elementsMake";
import { canEditElement, entryFor } from "@/lib/elementsDetail";
import { captureLook } from "@/lib/castLook";
import { deleteMediaSubject } from "@/lib/mediaSubjects";

export const elementsAppRoutes = apiRouter();
gateMediaApp(elementsAppRoutes, "elements", ["/actions/make", "/actions/capture-look", "/actions/delete"]);
elementsAppRoutes.post("/actions/make", requireAuth, async (c, next) => {
  const person = c.get("person");
  if (!appRouteAllowed(person, "elements", "actions", "make")) return next();
  const made = await makeElementFromWords(person, await jsonBody(c));
  return made.ok
    ? c.json({ ok: true as const, id: made.ids[0], ids: made.ids, state: getPictureJob(person, made.ids[0]!)?.state ?? "queued", notice: made.notice }, 200)
    : c.json({ error: made.error, code: made.code }, made.status as never);
});

// ELEMENTS-HOME-02: the detail page's two actions. "Capture the look" is the app's own plugin call to the existing look capture (`captureLook`, the one sheet builder);
// Delete is for the owner's own saved elements only (a companion or household member is one personality record).
elementsAppRoutes.post("/actions/capture-look", requireAuth, async (c, next) => {
  const person = c.get("person");
  if (!appRouteAllowed(person, "elements", "actions", "capture-look")) return next();
  const body = await jsonBody(c);
  const entry = typeof body.id === "string" ? entryFor(person, body.id) : null;
  if (!entry?.subject_id) return c.json({ error: "That element is not available. Open it from the list and try again.", code: "not_found" }, 404);
  const made = await captureLook(person, entry.subject_id, { force: true });
  return made.ok ? c.json({ ok: true as const, line: made.reused ? "The look was already up to date." : "The look sheet is ready." }, 200) : c.json({ error: made.line, code: "refused" }, 400);
});
elementsAppRoutes.post("/actions/delete", requireAuth, async (c, next) => {
  const person = c.get("person");
  if (!appRouteAllowed(person, "elements", "actions", "delete")) return next();
  const body = await jsonBody(c);
  const entry = typeof body.id === "string" ? entryFor(person, body.id) : null;
  if (!entry?.subject_id || !canEditElement(person, entry.id)) return c.json({ error: "That element cannot be deleted here. A companion or household member is edited where that record lives.", code: "not_allowed" }, 403);
  return deleteMediaSubject(person, entry.subject_id) ? c.json({ ok: true as const, line: "Deleted." }, 200) : c.json({ error: "That element could not be deleted. Try again.", code: "failed" }, 400);
});
