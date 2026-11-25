// STACK-MODELS-HOME-01 (owner decision, 2026-11-21): `/api/ai/stack/*`, Home's forwarder for the shared "AI and models" page. The Stack holds every
// model choice; this stores nothing. Each route checks who is asking with Home's own rules (an owner or admin, on the adult lane, signed in),
// forwards the call to the matching `/stack/v1/*` route unchanged, passes the Stack's sentence and status back as they are, and writes one audit
// line for a change. What stays Home's: the per-person "who may use each level" (settings `engines.<role>.tier.<tier>`, no model in it that matters),
// the chat lease and the disk and backup links. The paths mirror the Stack's: `/api/ai/stack/choices...` is `/stack/v1/choices...`.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { forwardToStack, refusalStatus, StackChoicesError, type Forwarded } from "@/lib/stackChoicesForward";
import { coveredConsent } from "@/lib/stackComponents";
import { dismissMigrationNotice, ensureChoicesMigrated, HOME_FEATURE_SWITCHES, readMigrationRecord } from "@/lib/stackChoicesMigration";
import { readAdminLink } from "@/lib/stackAdminLink";
import { refreshStackChoiceSnapshot } from "@/lib/stackChoiceSnapshot";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { dropPictureStatusCache } from "@/lib/pictures/ready";
import { dropVideoStatusCache } from "@/lib/videos/ready";
import { dropMusicStatusCache } from "@/lib/music/ready";
import type { PersonRow } from "@/types";

export const aiStackRoutes = apiRouter();

const refusals = errorResponses({ 400: "The Stack refused the value (its sentence says why)", 401: "Not signed in", 403: "Admins only", 404: "Not found", 409: "Not possible right now (the sentence says why)", 503: "The engine is not answering" });
const Any = z.record(z.string(), z.unknown());
const ok = (description: string) => ({ 200: { content: { "application/json": { schema: Any } }, description }, ...refusals });
const categoryParam = z.object({ category: z.string().min(1).max(40) });
const pickParams = z.object({ category: z.string().min(1).max(40), tier: z.string().min(1).max(20) });
const idParam = z.object({ id: z.string().min(1).max(200) });
const body = (required = true) => ({ required, content: { "application/json": { schema: z.unknown() } } });

const NOT_ADULT = "Only an adult admin can change the AI and models.";
const gate = (c: Context): Response | null => (laneOfPerson(c.get("person") as PersonRow) === "adult" ? null : c.json({ error: NOT_ADULT, code: "adult_only" }, 403));
const readBody = async (c: Context): Promise<unknown> => { try { return await c.req.json(); } catch { return {}; } };
const audit = (c: Context, what: string, status: number) => console.log(`[ai-stack] ${what} person=${(c.get("person") as PersonRow).id} status=${status}`);

/** Runs one forwarded call: the adult gate, the Stack's answer as it is, the Stack's refusal sentence and status, one audit line for a change. */
async function pass(c: Context, what: string, call: () => Promise<Forwarded>, after?: () => Promise<void> | void): Promise<never> {
  const denied = gate(c);
  if (denied) return denied as never;
  try {
    const answer = await call();
    if (what !== "read") audit(c, what, answer.status);
    await after?.();
    return c.json(answer.body as never, answer.status as never) as never;
  } catch (error) {
    if (error instanceof StackChoicesError) { if (what !== "read") audit(c, `${what} refused code=${error.code}`, refusalStatus(error)); return c.json({ error: error.message, code: error.code }, refusalStatus(error) as never) as never; }
    throw error;
  }
}
const choicesChanged = async () => { dropPictureStatusCache(); dropVideoStatusCache(); dropMusicStatusCache(); resetInstallStatusCache(); await refreshStackChoiceSnapshot(); };

aiStackRoutes.openapi(createRoute({ method: "get", path: "/choices", tags: ["AI"], summary: "Everything the AI and models page shows (the Stack's GET /stack/v1/choices)", middleware: [requireRole("owner", "admin")] as const, responses: ok("The Stack's answer, unchanged.") }),
  (c) => pass(c, "read", async () => { await ensureChoicesMigrated(); return forwardToStack("GET", "/stack/v1/choices"); }));

aiStackRoutes.openapi(createRoute({ method: "get", path: "/choices/unused", tags: ["AI"], summary: "Installed models nothing uses (the Stack's GET /stack/v1/choices/unused)", middleware: [requireRole("owner", "admin")] as const, responses: ok("The Stack's answer, unchanged.") }),
  (c) => pass(c, "read", () => forwardToStack("GET", "/stack/v1/choices/unused")));

aiStackRoutes.openapi(createRoute({ method: "post", path: "/choices/unused/remove", tags: ["AI"], summary: "Remove the chosen unused models (the Stack's POST /stack/v1/choices/unused/remove)", middleware: [requireRole("owner", "admin")] as const, request: { body: body() }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => pass(c, "choices.unused.remove", async () => forwardToStack("POST", "/stack/v1/choices/unused/remove", await readBody(c)), choicesChanged));

aiStackRoutes.openapi(createRoute({ method: "post", path: "/choices/recommended", tags: ["AI"], summary: "Preview or apply the recommended setup (the Stack's POST /stack/v1/choices/recommended)", middleware: [requireRole("owner", "admin")] as const, request: { body: body(false) }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => { const sent = (await readBody(c)) as { dry_run?: unknown }; return pass(c, sent.dry_run === true ? "read" : "choices.recommended", () => forwardToStack("POST", "/stack/v1/choices/recommended", sent), sent.dry_run === true ? undefined : choicesChanged); });

aiStackRoutes.openapi(createRoute({ method: "post", path: "/choices/add-model", tags: ["AI"], summary: "Add a chat model from a Hugging Face link (the Stack's POST /stack/v1/choices/add-model)", middleware: [requireRole("owner", "admin")] as const, request: { body: body() }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => pass(c, "choices.add-model", async () => forwardToStack("POST", "/stack/v1/choices/add-model", await readBody(c)), choicesChanged));

aiStackRoutes.openapi(createRoute({ method: "put", path: "/choices/{category}/order", tags: ["AI"], summary: "A category's model order and off list (the Stack's PUT /stack/v1/choices/{category}/order)", middleware: [requireRole("owner", "admin")] as const, request: { params: categoryParam, body: body() }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => pass(c, `choices.order ${c.req.valid("param").category}`, async () => forwardToStack("PUT", `/stack/v1/choices/${encodeURIComponent(c.req.valid("param").category)}/order`, await readBody(c)), choicesChanged));

aiStackRoutes.openapi(createRoute({ method: "put", path: "/choices/{category}/{tier}", tags: ["AI"], summary: "The model for a category and level (the Stack's PUT /stack/v1/choices/{category}/{tier})", middleware: [requireRole("owner", "admin")] as const, request: { params: pickParams, body: body() }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => { const { category, tier } = c.req.valid("param"); return pass(c, `choices.pick ${category}.${tier}`, async () => forwardToStack("PUT", `/stack/v1/choices/${encodeURIComponent(category)}/${encodeURIComponent(tier)}`, await readBody(c)), choicesChanged); });

// Feature switch and priority: the Stack's role settings, and only those keys. A switch Home also has a setting for (Chat paused, Videos on, ...) is written
// to that setting in the same call, because Home's own screens and tools read it; the Stack's value is the one the page shows.
const ROLE_KEY = /^stack\.roles\.(chat|coding|judge|router|embed|rerank|vision|stt|tts|wakeword|image|video|music|helper)\.(enabled|priority)$/;
aiStackRoutes.openapi(createRoute({ method: "put", path: "/settings", tags: ["AI"], summary: "Switch a feature on or off, or set its priority (the Stack's PUT /stack/v1/settings, role keys only)", middleware: [requireRole("owner", "admin")] as const, request: { body: body() }, responses: ok("The Stack's answer, unchanged.") }),
  async (c) => {
    const sent = await readBody(c);
    const entries = typeof sent === "object" && sent !== null && !Array.isArray(sent) ? Object.entries(sent as Record<string, unknown>) : [];
    if (entries.length === 0 || entries.some(([key, value]) => !ROLE_KEY.test(key) || (key.endsWith(".enabled") ? typeof value !== "boolean" : typeof value !== "number"))) return c.json({ error: "This page can only switch a feature on or off or set its priority.", code: "invalid_input" }, 400) as never;
    return pass(c, `settings ${entries.map(([key]) => key.replace(/^stack\.roles\./, "")).join(",")}`, () => forwardToStack("PUT", "/stack/v1/settings", sent), async () => {
      for (const [key, value] of entries) {
        const role = ROLE_KEY.exec(key)![1]; const home = HOME_FEATURE_SWITCHES.find((entry) => entry.role === role);
        if (home && key.endsWith(".enabled")) setHouseholdSettingValue(home.key, home.invert ? !value : value);
      }
      await choicesChanged();
    });
  });

aiStackRoutes.openapi(createRoute({ method: "post", path: "/parts/{id}/install", tags: ["AI"], summary: "Download a model (the Stack's POST /stack/v1/parts/{id}/install)", middleware: [requireRole("owner", "admin")] as const, request: { params: idParam, body: body(false) }, responses: { 202: { content: { "application/json": { schema: Any } }, description: "Started or joined." }, ...ok("Already installed.") } }),
  async (c) => {
    const { id } = c.req.valid("param"); const sent = (await readBody(c)) as { accepted_licence?: unknown };
    const person = c.get("person") as PersonRow;
    return pass(c, `parts.install ${id}`, async () => {
      // A licence the household's acknowledgement already covers installs with no click; the Stack still gets the notice id it requires.
      const consent = typeof sent.accepted_licence === "string" ? { accepted_licence: sent.accepted_licence, accepted_by: person.id } : await coveredConsent(id).then((found) => found ? { accepted_licence: found.acceptedLicence, ...(found.acceptedBy ? { accepted_by: found.acceptedBy } : {}) } : undefined);
      return forwardToStack("POST", `/stack/v1/parts/${encodeURIComponent(id)}/install`, consent);
    }, choicesChanged);
  });

aiStackRoutes.openapi(createRoute({ method: "delete", path: "/parts/{id}", tags: ["AI"], summary: "Remove a model (the Stack's DELETE /stack/v1/parts/{id})", middleware: [requireRole("owner", "admin")] as const, request: { params: idParam }, responses: ok("The Stack's answer, unchanged.") }),
  (c) => pass(c, `parts.remove ${c.req.valid("param").id}`, () => forwardToStack("DELETE", `/stack/v1/parts/${encodeURIComponent(c.req.valid("param").id)}`), choicesChanged));

// The one-time move of Home's old values (lib/stackChoicesMigration.ts) and the notice for any value the Stack refused.
const migrationView = () => { const record = readMigrationRecord(); return { done: record !== null, done_at: record?.done_at ?? null, accepted: record?.accepted ?? 0, refused: record?.refused ?? [], dismissed: record?.dismissed ?? false }; };
aiStackRoutes.openapi(createRoute({ method: "get", path: "/migration", tags: ["AI"], summary: "Whether Home's old model values reached the Stack, and the ones the Stack refused", middleware: [requireRole("owner", "admin")] as const, responses: ok("The recorded result of the one-time move.") }),
  async (c) => { await ensureChoicesMigrated().catch(() => null); return c.json(migrationView(), 200) as never; });
aiStackRoutes.openapi(createRoute({ method: "post", path: "/migration/dismiss", tags: ["AI"], summary: "The admin has read the notice about refused values (they stay in Home)", middleware: [requireRole("owner", "admin")] as const, responses: ok("The recorded result.") }),
  (c) => { dismissMigrationNotice(); return c.json(migrationView(), 200) as never; });

// Where the Stack's own admin page is (its address on this computer, and over Tailscale when the Stack allows it), for the "Open Stack admin" link.
aiStackRoutes.openapi(createRoute({ method: "get", path: "/admin-link", tags: ["AI"], summary: "Where the Stack's own admin page is", middleware: [requireRole("owner", "admin")] as const, responses: ok("The link and the plain reason.") }),
  async (c) => { const denied = gate(c); if (denied) return denied as never; return c.json(await readAdminLink(), 200) as never; });

// Drives (multi-disk, 2026-11-25): which drives hold the models, where each feature's files are, and the Move button. The Stack does the work;
// these pass the calls through unchanged (`/api/ai/stack/disks...` is `/stack/v1/disks...`).
const driveRoute = (method: "get" | "post", path: string, summary: string) => createRoute({ method, path, tags: ["AI"], summary, middleware: [requireRole("owner", "admin")] as const, ...(method === "post" ? { request: { body: body(false) } } : {}), responses: ok(summary) });
aiStackRoutes.openapi(driveRoute("get", "/disks", "The drives that hold models (the Stack's GET /stack/v1/disks)"), (c) => pass(c, "read", () => forwardToStack("GET", "/stack/v1/disks")));
aiStackRoutes.openapi(driveRoute("get", "/disks/features", "Which drive each feature's files are on (the Stack's GET /stack/v1/disks/features)"), (c) => pass(c, "read", () => forwardToStack("GET", "/stack/v1/disks/features")));
aiStackRoutes.openapi(driveRoute("get", "/disks/moves", "Recent moves with progress (the Stack's GET /stack/v1/disks/moves)"), (c) => pass(c, "read", () => forwardToStack("GET", "/stack/v1/disks/moves")));
aiStackRoutes.openapi(driveRoute("post", "/disks/moves", "Plan or start moving a feature's files to another drive (the Stack's POST /stack/v1/disks/moves)"),
  async (c) => { const sent = (await readBody(c)) as { dry_run?: unknown }; return pass(c, sent.dry_run === true ? "read" : "disks.move", () => forwardToStack("POST", "/stack/v1/disks/moves", sent), sent.dry_run === true ? undefined : choicesChanged); });
aiStackRoutes.openapi(driveRoute("post", "/disks/moves/cancel", "Cancel the running move (the Stack's POST /stack/v1/disks/moves/cancel)"), (c) => pass(c, "disks.move.cancel", () => forwardToStack("POST", "/stack/v1/disks/moves/cancel", {})));
