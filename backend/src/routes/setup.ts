// The setup wizard's API surface. Session F step 5 shipped the "trust
// this hub" piece (`GET /api/setup/ca`); step 11 adds `POST /api/setup/
// hardware` (install.sh's own minimums check, and the wizard's hardware
// step's data source). The rest (household, owner, acknowledgment,
// packages, remote, emergency_kit, backup, done - the wave-2 contract's
// full `GET /api/setup/state`/`POST /api/setup/:step`) still land with
// later steps that build the things each one actually configures.
import { createRoute, z } from "@hono/zod-openapi";
import { SearchTestSummarySchema } from "@/lib/searchTestSummary";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { getHouseholdCaCertificate, ensureHouseholdLeaf } from "@/lib/householdCa";
import { getHubName } from "@/lib/hubIdentity";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { tryConsume } from "@/lib/rateLimiter";
import { getClientIp } from "@/lib/secretThrottle";
import { detectHardware } from "@/lib/hardware";
import { recommend } from "@/lib/modelCatalog";
import { setupLocalOnly } from "@/middleware/setupLocalOnly";
import { setupFolderRoutes } from "@/routes/setupFolders";
import { setupHostTuneRoutes } from "@/routes/setupHostTune";
import { setupCloseAppsRoutes } from "@/routes/setupCloseApps";
import { getCookie } from "hono/cookie";
import { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import { resolveHumanSession, requireRole } from "@/middleware/auth";
import { validateProposedPath } from "@/lib/folderBrowse";
import { checkPlacement } from "@/lib/placement";
import { getSetupState, PRE_OWNER_STEPS, replaceSetupStep, SETUP_STEP_IDS, setSetupCodingChoice, type SetupStepId } from "@/lib/setupState";
import { db } from "@/db";
import { people } from "@/db/schema";
import { runSetupChecks, healthItems, webSearchNeedsSetup } from "@/setup/checks/checks";
import { startSetupDownloads } from "@/setup/checks/setupDownloads";
import { cannotRunJobs, readCapabilities } from "@/lib/memoryRoom";
import { beginInstall, engineNeedsInstall, previewPlan } from "@/lib/installActions";
import { startEngineInstall } from "@/lib/stackInstall";
import { getStackClient } from "@/lib/stackEngine";
import { getInstallStatus } from "@/lib/installStatus";
import { InstallStatusSchema } from "@/routes/install";
import { adoptLicenceAck } from "@/lib/licenceAcceptance";
import { acceptLicences, licenceOverview, widenLicenceAck } from "@/lib/licenceFlow";
import { setHouseholdSettingValue } from "@/lib/settings";
import { SETUP_CHOICE_KEYS, setupCards } from "@/lib/aiChoicesState";
import type { DiskPlan } from "../../../shared/diskPlanMath";
import { REMOTE_ALLOW_TAILNET_KEY, refreshConfiguredEngineLink, validateRemoteEngineSetting } from "@/lib/remoteStackSettings";
import { codingModeReadiness } from "@/lib/codingMode";
import { listCodingPieces, installCodingPiece, type CodingPieceId } from "@/lib/stackCodingPieces";

// A person on the household's own LAN hits this a handful of times while
// working through the trust step, never dozens of times a second - the
// same "a person's pace" budget CLAUDE.md's third-party-services section
// asks of every outbound integration, applied here to an unauthenticated
// inbound route instead. A code review (2026-09-06) found this route
// unthrottled despite spawning a `tailscale status` subprocess
// (getTailscaleStatus(), via listHubEndpoints()) on every single call -
// an unauthenticated caller could otherwise hammer the hub into spawning
// subprocesses as fast as it can accept connections.
const SETUP_CA_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };

export const setupRoutes = apiRouter();
setupRoutes.use("*", setupLocalOnly);
// WIZ-STORAGE-02: folder picker endpoints; mounted before the `/{step}` catch-all below.
setupRoutes.route("/", setupFolderRoutes);
// HOST-TUNE-01: the Mac tuning step; also before the catch-all.
setupRoutes.route("/", setupHostTuneRoutes);
// MEM-SPACE-12: the Close apps question and its permission test.
setupRoutes.route("/", setupCloseAppsRoutes);

const codingChoiceBody = z.object({ choice: z.enum(["set_up", "later"]) }).strict();
const setupCodingPieceSchema = z.object({ id: z.string(), label: z.string(), size_bytes: z.number().nullable(), state: z.enum(["installed", "installing", "notInstalled", "failed", "unsupported"]) });
const setupCodingRoute = createRoute({ method:"get", path:"/coding", tags:["Setup"], summary:"The coding screen in the setup wizard", middleware:[requireRole("owner","admin")] as const,
  responses:{200:{content:{"application/json":{schema:z.object({eligible_mode:z.boolean(),pieces:z.array(setupCodingPieceSchema),total_bytes:z.number(),readiness:z.unknown()})}},description:"Coding setup choices and current readiness."}, ...errorResponses({401:"Not signed in",403:"Admins only"})} });
setupRoutes.openapi(setupCodingRoute, async c => {
  const [plan, listed, readiness] = await Promise.all([previewPlan(), listCodingPieces(), codingModeReadiness()]);
  const eligible = (plan.plan as {tier?:string|null} | null)?.tier === "p128";
  const byId = new Map(listed.pieces.map(piece => [piece.id, piece]));
  const ids: CodingPieceId[] = ["engine","model","draft", ...(eligible ? ["heavy_model","heavy_draft"] as const : [])];
  const pieces = ids.flatMap(id => {
    const piece = byId.get(id);
    return piece ? [{id,label:piece.label,size_bytes:piece.size_bytes,state:piece.state}] : [];
  });
  return c.json({eligible_mode:eligible,pieces,total_bytes:pieces.reduce((sum,piece) => sum + (piece.state === "installed" ? 0 : piece.size_bytes ?? 0),0),readiness},200);
});

const setupCodingChoiceRoute = createRoute({ method:"post", path:"/coding", tags:["Setup"], summary:"Choose the recommended coding setup or do it later", middleware:[requireRole("owner","admin")] as const,
  request:{body:{content:{"application/json":{schema:codingChoiceBody}}}},
  responses:{200:{content:{"application/json":{schema:z.object({ok:z.literal(true),choice:z.literal("later")})}},description:"The person chose to do this later."},202:{content:{"application/json":{schema:z.object({ok:z.literal(true),choice:z.literal("set_up"),pieces:z.array(z.object({id:z.string(),state:z.string()}))})}},description:"The recommended downloads were started."},409:{content:{"application/json":{schema:z.object({error:z.string()})}},description:"Setup is not available or the disk plan does not fit."},...errorResponses({400:"The setting could not be saved",401:"Not signed in",403:"Admins only"})} });
setupRoutes.openapi(setupCodingChoiceRoute, async c => {
  if (!db.select({id:people.id}).from(people).limit(1).get()) return c.json({error:"Create the Home owner first."},409);
  const {choice} = c.req.valid("json");
  if (choice === "later") {
    setSetupCodingChoice("later");
    return c.json({ok:true as const,choice:"later" as const},200);
  }
  const plan = await previewPlan();
  if (plan.wording.diskLine) return c.json({error:plan.wording.diskLine},409);
  const saved = setHouseholdSettingValue("coding.enabled",true);
  if (!saved.ok) return c.json({error:saved.error},saved.status);
  setSetupCodingChoice("set_up");
  const eligible = (plan.plan as {tier?:string|null} | null)?.tier === "p128";
  const listed = await listCodingPieces();
  const ids: CodingPieceId[] = ["engine","model","draft", ...(eligible ? ["heavy_model","heavy_draft"] as const : [])];
  const outcomes: Array<{id:CodingPieceId;state:string}> = [];
  const started = new Set<CodingPieceId>();
  for (const id of ids) {
    const piece = listed.pieces.find(candidate => candidate.id === id);
    if (!piece) continue;
    let state = piece.state;
    if (piece.can_install) {
      try { await installCodingPiece(id); state = "installing"; started.add(id); }
      catch { /* The Stack's own piece state remains visible for the person to retry. */ }
    }
    if (id === "draft" && started.has("model") && state === "notInstalled") state = "installing";
    outcomes.push({id,state});
  }
  return c.json({ok:true as const,choice:"set_up" as const,pieces:outcomes},202);
});

const checksRoute = createRoute({
  method: "post", path: "/checks/run", tags: ["Setup"], summary: "Run setup checks and persist their health items",
  responses: { 200: { content: { "application/json": { schema: z.object({ rows: z.array(z.object({ id: z.string(), title: z.string(), state: z.enum(["green", "amber", "red", "idle"]), text: z.string() })), state: SetupState, searchCandidate: z.string().nullable(), searchNeeded: z.boolean() }) } }, description: "The ordered check rows and updated setup state. searchNeeded: setup should offer the Web search screen." } },
});
const allowTailnetErrorSchema = z.object({ error: z.string(), next: z.string().optional() });
setupRoutes.openapi(checksRoute, async (c) => {
  const candidatesOut: Array<{ url: string; status: "pass" | "fail" }> = [];
  const rows = await runSetupChecks({ candidatesOut, preInstall: true });
  const passed = rows.every((row) => row.state === "green" || row.state === "idle");
  const current = getSetupState();
  let engine = current.engine;
  if (passed) {
    try {
      const facts = await getStackClient().hardware();
      engine = { ...current.engine, hardware: facts };
    } catch { /* Keep the last known facts if Stack went away after the checks. */ }
  }
  const state = replaceSetupStep("checks", { status: rows.some((row) => row.state === "red") ? "failed" : "done", checks: healthItems(rows), engine });
  if (passed) void startSetupDownloads().catch(() => {});
  return c.json({ rows: rows.map(({ id, title, state, text, action, actionLabel, actionRoute }) => ({ id, title, state, text, ...(action ? { action, actionLabel, actionRoute } : {}) })), state, searchCandidate: candidatesOut.find((item) => item.status === "pass")?.url ?? null, searchNeeded: webSearchNeedsSetup(rows) }, 200);
});

const installStatusRoute = createRoute({
  method: "get", path: "/install", tags: ["Setup"], summary: "What the AI install is doing, for the wizard footer",
  responses: { 200: { content: { "application/json": { schema: InstallStatusSchema } }, description: "The install summary." } },
});
setupRoutes.openapi(installStatusRoute, async (c) => c.json(await getInstallStatus(), 200));

const SetupErrorSchemaForInstall = z.object({ error: z.string(), next: z.string().optional() });
const PlanWordingSchema = z.object({
  level: z.enum(["recommended", "moderate", "minimal", "below_minimum", "unknown"]), headline: z.string(), detail: z.string(),
  gets: z.array(z.string()), needsMemoryAnswer: z.boolean(), sizeLine: z.string().nullable(), diskLine: z.string().nullable(), disk: z.unknown().nullable(),
});
const planQuery = z.object({ vram_gb: z.coerce.number().int().min(1).max(512).optional() });
const planRoute = createRoute({
  method: "get", path: "/plan", tags: ["Setup"], summary: "What Home would install on the AI computer",
  request: { query: planQuery },
  responses: { 200: { content: { "application/json": { schema: z.object({ plan: z.unknown().nullable(), wording: PlanWordingSchema, licences: z.array(z.object({ row_id: z.string(), component: z.string(), id: z.string(), name: z.string(), url: z.string(), summary: z.array(z.string()), accepted_at: z.string().nullable(), covered: z.boolean().optional() })).optional().describe("The licences of the licensed rows on this plan (Detailed video): the notice to show, and whether it was already accepted."), choices: z.object({ cards: z.array(z.unknown()), alwaysOn: z.unknown() }).nullable().optional().describe("The same job cards Settings shows (AI and models), built from this plan; null when there is no disk plan to build them from."), cannot_run: z.array(z.string()).optional().describe("Job ids (pictures, videos, music, voice) the Stack's capability table says no tier can run on this computer; the wizard leaves them off. Empty when the Stack cannot say.") }) } }, description: "The Stack's plan and Home's words for it." } },
});
setupRoutes.openapi(planRoute, async (c) => {
  const { vram_gb: vramGb } = c.req.valid("query");
  const preview = await previewPlan(vramGb);
  const disk = preview.wording.disk?.plan as DiskPlan | undefined;
  // The wizard shows the same job cards as Settings, so they come from the same builder (shared/aiChoices.ts).
  return c.json({ ...preview, choices: disk ? await setupCards(disk) : null, cannot_run: cannotRunJobs(await readCapabilities()) }, 200);
});

const installStartRoute = createRoute({
  method: "post", path: "/install", tags: ["Setup"], summary: "Install the plan: start the downloads and go on",
  request: { body: { content: { "application/json": { schema: z.object({ vram_gb: z.number().int().min(1).max(512).optional(), accepted_licences: z.array(z.string().max(120)).max(8).optional().openapi({ description: "Ids of the licence notices the person read and accepted for licensed rows (Detailed video). A licensed row left on without its accept is refused." }), components: z.array(z.string()).optional().openapi({ description: "The disk plan rows to install (ids from the plan's disk.plan.rows). Required rows are always installed; omitted means the plan's defaults." }), settings: z.record(z.string(), z.union([z.string(), z.boolean()])).optional().openapi({ description: "The household settings the chosen job cards carry (the picture, video and music choices). Written once the install can start; keys outside the card settings are refused." }) }).strict() } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true), models: z.number() }) } }, description: "The downloads started in the background." },
    409: { content: { "application/json": { schema: SetupErrorSchemaForInstall } }, description: "There is nothing the AI can install on this computer, or not enough free disk space for the rows chosen." },
  },
});
setupRoutes.openapi(installStartRoute, async (c) => {
  // This router is open on the local network until Home has an owner.
  if (db.select({ id: people.id }).from(people).limit(1).get()) return c.json({ error: "Home is already set up. Sign in instead.", next: "Change the AI under Home settings." }, 409);
  const { vram_gb: vramGb, components, accepted_licences: acceptedLicences, settings } = c.req.valid("json");
  const unknownKey = Object.keys(settings ?? {}).find((key) => !SETUP_CHOICE_KEYS.has(key));
  if (unknownKey) return c.json({ error: `${unknownKey} is not a choice setup can save.`, next: "Reload this page and choose again." }, 409);
  // LICENCE-ACK-01: the first-run record now names every licence the plan page listed.
  await widenLicenceAck("setup");
  const result = await beginInstall(vramGb, true, components, acceptedLicences);
  if (!result.ok) return c.json({ error: result.error, next: result.next }, 409);
  // The choice is saved only once the download can start, so a refused install leaves the settings as they were.
  for (const [key, value] of Object.entries(settings ?? {})) {
    const written = setHouseholdSettingValue(key, value);
    if (!written.ok) return c.json({ error: written.error, next: "Change it later under AI and models in Settings." }, 409);
  }
  return c.json({ started: true as const, models: result.models }, 202);
});

const licencesRoute = createRoute({
  method: "get", path: "/licences", tags: ["Setup"], summary: "The licences Home lists with the wizard's internet item, and whether they were accepted",
  responses: { 200: { content: { "application/json": { schema: z.object({ stack: z.enum(["ok", "unreachable"]), terms_version: z.string(), acknowledged: z.unknown().nullable(), licences: z.array(z.unknown()) }) } }, description: "Each licensed part the AI engine lists (empty before the engine exists)." } },
});
setupRoutes.openapi(licencesRoute, async (c) => {
  const { stack, terms_version, acknowledged, licences } = await licenceOverview();
  return c.json({ stack, terms_version, acknowledged, licences }, 200);
});
const licencesAcceptRoute = createRoute({
  method: "post", path: "/licences/accept", tags: ["Setup"], summary: "Record the wizard's acknowledgement, including the licences",
  responses: { 200: { content: { "application/json": { schema: z.object({ accepted: z.literal(true) }) } }, description: "Recorded for the household." }, 409: { content: { "application/json": { schema: SetupErrorSchemaForInstall } }, description: "Home already has an owner: the admin prompt in Home settings does this instead." } },
});
setupRoutes.openapi(licencesAcceptRoute, async (c) => {
  if (db.select({ id: people.id }).from(people).limit(1).get()) return c.json({ error: "Home is already set up. Sign in instead.", next: "An owner or admin accepts the licences from the prompt in Home settings." }, 409);
  await acceptLicences("setup");
  return c.json({ accepted: true as const }, 200);
});

const engineInstallRoute = createRoute({
  method: "post", path: "/engine-install", tags: ["Setup"], summary: "Start (or restart) installing the AI engine on this computer",
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true) }) } }, description: "The engine install is running. Nothing happens when this computer already has an engine or the AI runs on another computer." },
    409: { content: { "application/json": { schema: SetupErrorSchemaForInstall } }, description: "Home could not start the install." },
  },
});
setupRoutes.openapi(engineInstallRoute, (c) => {
  if (db.select({ id: people.id }).from(people).limit(1).get()) return c.json({ error: "Home is already set up. Sign in instead.", next: "Change the AI under Home settings." }, 409);
  if (!engineNeedsInstall()) return c.json({ started: true as const }, 202);
  const started = startEngineInstall();
  if (!started.ok) return c.json({ error: started.error, next: started.next }, 409);
  return c.json({ started: true as const }, 202);
});

const useSearchCandidateRoute = createRoute({
  method: "post", path: "/search/use-candidate", tags: ["Setup"], summary: "Test or save the SearXNG address, or skip it and keep DuckDuckGo for adults",
  request: { body: { content: { "application/json": { schema: z.object({
    url: z.string().optional(),
    /** Run the same checks but save nothing: the Test button. */
    dry_run: z.boolean().optional(),
    /** With no url: setup is skipping SearXNG, so DuckDuckGo (adults only) is turned on (owner ruling 2026-10-17). */
    ddgs_default: z.boolean().optional(),
  }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ saved: z.boolean(), result: SearchTestSummarySchema.optional() }) } }, description: "A Test answers 200 with result (pass, warn or fail in plain words) and saved false; a Save answers 200 with saved true once it, or the skip choice, was saved." }, 400: { content: { "application/json": { schema: allowTailnetErrorSchema } }, description: "The address is not allowed, or a Save found the service not usable." } },
});
setupRoutes.openapi(useSearchCandidateRoute, async (c) => {
  if (db.select({ id: people.id }).from(people).limit(1).get()) return c.json({ error: "Home is already set up. Sign in instead." }, 400);
  const { url, dry_run: dryRun, ddgs_default: ddgsDefault } = c.req.valid("json");
  if (url === undefined) {
    // Skipping SearXNG: adults get DuckDuckGo by default (it answers once its helper runs). Nothing else is saved.
    if (dryRun || !ddgsDefault) return c.json({ error: "Type the SearXNG address first, then press Test." }, 400);
    const picked = setHouseholdSettingValue("search.web_sources", ["searxng", "ddgs"]);
    return picked.ok ? c.json({ saved: true }, 200) : c.json({ error: picked.error }, 400);
  }
  const { testOrSaveSearchAddress } = await import("@/lib/searchAddressSave");
  const outcome = await testOrSaveSearchAddress(url, dryRun === true);
  if (outcome.kind === "refused") return c.json({ error: outcome.error, ...(outcome.next ? { next: outcome.next } : {}) }, 400);
  return outcome.kind === "tested" ? c.json({ saved: false, result: outcome.result }, 200) : c.json({ saved: true }, 200);
});

const allowTailnetRoute = createRoute({
  method: "post", path: "/checks/allow-tailnet", tags: ["Setup"], summary: "Allow the engine link to use Tailscale",
  responses: {
    200: { content: { "application/json": { schema: z.object({ enabled: z.literal(true) }) } }, description: "Tailnet routing is enabled for the engine link." },
    400: { content: { "application/json": { schema: allowTailnetErrorSchema } }, description: "The engine link cannot use this Tailscale address." },
    403: { content: { "application/json": { schema: allowTailnetErrorSchema } }, description: "Only an owner or admin may enable this setting." },
  },
});
setupRoutes.openapi(allowTailnetRoute, async (c) => {
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (anyone) {
    return c.json({ error: "Home already has an owner. Sign in as an owner or admin and use Settings to allow Tailscale for the engine link." }, 403);
  }
  const refusal = await validateRemoteEngineSetting(REMOTE_ALLOW_TAILNET_KEY, true);
  if (refusal) return c.json({ error: refusal }, 400);
  const saved = setHouseholdSettingValue(REMOTE_ALLOW_TAILNET_KEY, true);
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  refreshConfiguredEngineLink();
  return c.json({ enabled: true as const }, 200);
});

const SetupStepIdSchema = z.enum(SETUP_STEP_IDS);
const SetupStatusSchema = SetupState.shape.steps.element.shape.status;
const SetupStepBodySchema = z.object({
  status: SetupStatusSchema,
  error: SetupState.shape.steps.element.shape.error.optional(),
  engine: SetupState.shape.engine.optional(),
  away: SetupState.shape.away.optional(),
  plan: SetupState.shape.plan.optional(),
  checks: SetupState.shape.checks.optional(),
  phase: SetupState.shape.phase.optional(),
  completed_at: SetupState.shape.completed_at.optional(),
  // WIZ-STORAGE-03: only for the storage step. `models` is absent on a split setup.
  models: z.string().optional(),
  records: z.string().optional(),
}).strict();
const SetupErrorSchema = z.object({ error: z.string(), next: z.string().optional() }).strict();

const setupStateRoute = createRoute({
  method: "get",
  path: "/state",
  tags: ["Setup"],
  summary: "Read setup progress and resume state",
  responses: {
    200: { content: { "application/json": { schema: z.union([SetupState, z.object({ done: z.literal(true) }).strict()]) } }, description: "The setup record or a completion flag." },
  },
});
setupRoutes.openapi(setupStateRoute, (c) => {
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (!anyone) return c.json(getSetupState(), 200);
  const token = getCookie(c, "session");
  const person = token ? resolveHumanSession(token) : null;
  if (person && (person.role === "owner" || person.role === "admin")) return c.json(getSetupState(), 200);
  return c.json({ done: true as const }, 200);
});

const setupStepRoute = createRoute({
  method: "post",
  path: "/{step}",
  tags: ["Setup"],
  summary: "Record a setup step result",
  request: {
    params: z.object({ step: z.string() }),
    body: { content: { "application/json": { schema: SetupStepBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: SetupState } }, description: "The updated setup record." },
    400: { content: { "application/json": { schema: SetupErrorSchema } }, description: "Unknown step id." },
    401: { content: { "application/json": { schema: SetupErrorSchema } }, description: "Owner sign-in required." },
    403: { content: { "application/json": { schema: SetupErrorSchema } }, description: "Only the owner may continue." },
    409: { content: { "application/json": { schema: SetupErrorSchema } }, description: "Setup is closed or a prerequisite is incomplete." },
  },
});
// Public (unauthenticated) by design, the same reason GET /api/auth/profiles
// is: a household member trusting the hub's CA is exactly the step that
// has to happen BEFORE the browser will show anything else without a
// certificate warning, so it can't itself require a session cookie the
// browser doesn't trust yet to send.
const caRoute = createRoute({
  method: "get",
  path: "/ca",
  tags: ["Setup"],
  summary: "The household CA certificate to install and trust",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            certificate: z.string().openapi({ description: "PEM-encoded CA certificate. Never a private key." }),
            hubName: z.string(),
            installHint: z.object({
              darwin: z.string(),
              windows: z.string(),
              ios: z.string(),
              android: z.string(),
              linux: z.string(),
            }),
            qrPayload: z
              .string()
              .nullable()
              .openapi({
                description:
                  "What a QR code for another device on the LAN should encode - this same endpoint's URL, so scanning it fetches the certificate directly. Rendering the actual QR image is a frontend concern (E's kit); this only supplies the data to encode. Null when no reachable address was detected (no LAN interface up) - there's nothing a QR code from a second device could reach.",
              }),
          }),
        },
      },
      description: "The CA certificate (minted on first call) plus a per-platform install hint.",
    },
    ...errorResponses({ 429: "Too many requests from this address" }),
  },
});
setupRoutes.openapi(caRoute, async (c) => {
  const ip = getClientIp(c);
  if (!tryConsume(`setup-ca:${ip}`, SETUP_CA_RATE_LIMIT)) {
    return c.json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }
  // Ensures a leaf certificate exists (and currently covers this hub's
  // detected addresses) at the same time a household is looking at the
  // trust step - the natural moment to mint both, not a separate,
  // easy-to-forget step.
  await ensureHouseholdLeaf();
  const endpoints = await listHubEndpoints();
  // Only a LAN-kind endpoint, never a fallback to `endpoints[0]` (a
  // second code review pass, 2026-09-06, caught that the first fix still
  // did this): a Tailscale or admin-added public row could sort ahead of
  // a LAN one, or be the only row at all, and would then get encoded into
  // a QR code whose entire purpose is "reachable from a second device on
  // THIS network" - a device on the physical LAN but off the tailnet
  // could scan a URL it can never reach. No LAN endpoint means nothing
  // reachable this way exists yet; null and "nothing to scan yet" is
  // honest, a non-LAN URL is not.
  const primary = endpoints.find((e) => e.kind === "lan");
  const qrPayload = primary ? `${primary.url}/api/setup/ca` : null;
  return c.json(
    {
      certificate: await getHouseholdCaCertificate(),
      hubName: getHubName(),
      installHint: {
        darwin: "Open the downloaded certificate, then in Keychain Access set it to \"Always Trust\" under System.",
        windows: "Open the downloaded certificate and install it into \"Trusted Root Certification Authorities\" for the local machine.",
        ios: "Install the profile in Settings, then turn it on under Settings > General > About > Certificate Trust Settings.",
        android: "Install it as a CA certificate under Settings > Security > Encryption & credentials.",
        linux: "Copy it into your distribution's CA trust store (e.g. /usr/local/share/ca-certificates/) and update it.",
      },
      qrPayload,
    },
    200,
  );
});

// Same "a person's pace" reasoning as the CA route above: unauthenticated
// (setup happens before a household exists) but bounded, since detecting
// CUDA devices spawns an nvidia-smi subprocess.
const SETUP_HARDWARE_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };

const hardwareRoute = createRoute({
  method: "post",
  path: "/hardware",
  tags: ["Setup"],
  summary: "Detected hardware and whether a chat model fits it",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            platform: z.string(),
            arch: z.string(),
            totalRamGb: z.number(),
            cpuCount: z.number(),
            isAppleSilicon: z.boolean(),
            cudaDevices: z.array(z.object({ name: z.string(), vramGb: z.number() })),
            chatFit: z.object({
              // false on a CPU-only, non-Apple-Silicon box: hardware.ts's
              // primaryBudgetBytes() has no chat-inference sizing model for
              // that case yet (returns 0, "no automatic recommendation
              // possible" by its own doc comment) - reporting a confident
              // pass/fail off a budget of 0 would be a false "meets
              // minimums" or a false "doesn't", neither of which is true;
              // "not determined" is the honest answer until CPU inference
              // is sized.
              determined: z.boolean(),
              meetsMinimum: z.boolean().nullable(),
              bestFit: z.object({ id: z.string(), label: z.string() }).nullable(),
            }),
          }),
        },
      },
      description: "Real detected hardware plus whether any implemented chat-role model fits it.",
    },
    ...errorResponses({ 429: "Too many requests from this address" }),
  },
});
setupRoutes.openapi(hardwareRoute, async (c) => {
  const ip = getClientIp(c);
  if (!tryConsume(`setup-hardware:${ip}`, SETUP_HARDWARE_RATE_LIMIT)) {
    return c.json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }
  const hw = await detectHardware();
  const fits = recommend("chat", hw);
  const determined = hw.isAppleSilicon || hw.cudaDevices.length > 0;
  const best = fits.find((f) => f.model.implemented && f.fits) ?? null;
  return c.json(
    {
      platform: hw.platform,
      arch: hw.arch,
      totalRamGb: hw.totalRamGb,
      cpuCount: hw.cpuCount,
      isAppleSilicon: hw.isAppleSilicon,
      cudaDevices: hw.cudaDevices.map((d) => ({ name: d.name, vramGb: Math.round(d.vramBytes / 1_073_741_824) })),
      chatFit: {
        determined,
        meetsMinimum: determined ? best !== null : null,
        bestFit: best ? { id: best.model.id, label: best.model.label } : null,
      },
    },
    200,
  );
});

// Register the catch-all setup step after fixed POST routes such as
// /hardware. Hono matches routes in registration order, and /{step}
// would otherwise capture the hardware request before its own handler.
setupRoutes.openapi(setupStepRoute, async (c) => {
  const rawStep = c.req.valid("param").step;
  const parsedStep = SetupStepIdSchema.safeParse(rawStep);
  if (!parsedStep.success) {
    return c.json({ error: "Unknown setup step.", next: "Use one of the documented setup step ids." }, 400);
  }
  const step = parsedStep.data as SetupStepId;
  const body = c.req.valid("json");
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (anyone && PRE_OWNER_STEPS.has(step)) {
    return c.json({ error: "Home is already set up. Sign in instead.", next: "Sign in to continue." }, 409);
  }
  if (anyone || step === "owner") {
    const token = getCookie(c, "session");
    const person = token ? resolveHumanSession(token) : null;
    if (!person) return c.json({ error: "Sign in as the owner to continue setup.", next: "Sign in with the owner account." }, 401);
    if (person.role !== "owner") return c.json({ error: "Only the owner can continue setup.", next: "Sign in with the owner account." }, 403);
  }
  if (step === "checks") {
    const state = getSetupState();
    const answered = (id: SetupStepId) => state.steps.some((entry) => entry.id === id && entry.status === "done");
    if (!answered("engine_location") || !answered("storage")) {
      return c.json({ error: "The engine location and storage questions are not both complete.", next: "Complete engine_location and storage before checks." }, 409);
    }
  }
  const { models, records, ...stepResult } = body;
  let storageChoice: { models?: string; records?: string } | undefined;
  if (models !== undefined || records !== undefined) {
    if (step !== "storage") return c.json({ error: "Folders can only be saved on the storage step.", next: "Send models and records with the storage step." }, 400);
    const layout = { ...(models ? { models } : {}), ...(records ? { records } : {}) };
    if (!models && !records) return c.json({ error: "No folder was chosen.", next: "Choose a folder, or keep the default folders." }, 400);
    for (const path of Object.values(layout)) {
      const problem = validateProposedPath(path);
      if (problem) return c.json({ error: problem, next: "Choose a different folder." }, 400);
    }
    const blocked = (await checkPlacement(layout)).find((row) => row.kind === "refusal");
    if (blocked) return c.json({ error: blocked.text, next: blocked.fix }, 400);
    // INTEGRATION POINT (DATA-LOCATION-01a): the lane that writes the location
    // record and restarts Home reads this choice via getStorageChoice().
    storageChoice = layout;
  }
  const updated = replaceSetupStep(step, { ...stepResult, ...(storageChoice ? { storageChoice } : {}) });
  // LICENCE-ACK-01: the first-run licence record belongs to the owner once there is one.
  if (step === "owner" && stepResult.status === "done") {
    const owner = (() => { const token = getCookie(c, "session"); return token ? resolveHumanSession(token) : null; })();
    if (owner) adoptLicenceAck(owner.id);
  }
  // "This computer runs the AI" is the moment the MaiPai Stack gets built
  // (INSTALL-SPLIT-01). "Another computer" installs nothing here. Before an
  // owner exists only: later changes go through Home settings.
  if (step === "engine_location" && stepResult.status === "done" && !anyone && updated.engine.where === "this_computer" && engineNeedsInstall()) {
    startEngineInstall();
  }
  return c.json(updated, 200);
});
