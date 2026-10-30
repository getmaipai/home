// AIMODELS-ROUTES-01: the five calls of the AI and models page (docs/design/ai-models-simple-2026-10-25.md,
// sections 4 to 6). The seven job cards and the set-to-recommended plan are the pure shared/aiChoices.ts
// functions over three inputs that already exist: the tier's disk plan, the Stack component list and the
// household settings. Picking a choice downloads first and writes the setting second, so a choice is never
// set to something missing. "Set everything to recommended" is safe to press twice and never removes
// anything. Free up space re-runs the unused test per id at removal time (lib/aiUnused.ts) and reports each
// id separately, so one failure never stops the rest. Owner and admin only; the Stack's own refusals pass
// through as its sentences, like routes/components.ts does.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { buildAiCards, recommendedPlan, type AiChoicesInput, type AiChoice } from "../../../shared/aiChoices";
import type { DiskPlan } from "../../../shared/diskPlanMath";
import { aiCopy, ADDED_CHAT_DESCRIPTION } from "@/lib/aiCopy";
import { findUnused, plainPartName, qualified, whyKept, type UnusedInput } from "@/lib/aiUnused";
import { installStackComponent, listStackComponents, listTierCandidates, type TierStackCategory, StackComponentError, uninstallStackComponent, type StackComponent, type StackComponentList } from "@/lib/stackComponents";
import { previewPlan } from "@/lib/installActions";
import { recordedLevel, shippedPlanForLevel } from "@/lib/diskPlan";
import { systemAvailableBytes } from "@/lib/resourceGovernor";
import { ensureWakewordAssets, removeWakewordAssets, wakewordAssetState } from "@/lib/wakewordAssets";
import { setHouseholdSettingValue } from "@/lib/settings";
import { catalogEntries } from "@/lib/modelCatalog";
import { addedChatChoiceStates, startChatModelChoice, uncensoredChoiceState } from "@/lib/chatModelSwitch";
import { addChatModel, AddModelError, inspectForAdd } from "@/lib/addModel";
import { activeProfileLine, endMaxWindow, openMaxWindow } from "@/lib/jobs/householdQueue";
import { closedAppsLines } from "@/lib/jobs/closeApps";
import { readAiSettings } from "@/lib/aiChoicesState";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { dropPictureStatusCache } from "@/lib/pictures/ready";
import { dropVideoStatusCache } from "@/lib/videos/ready";
import { dropMusicStatusCache } from "@/lib/music/ready";

export const aiChoicesRoutes = apiRouter();

const JOBS = ["chat", "pictures", "picturesdetailed", "videos", "music", "voice", "wakeword", "vision", "coding"] as const;
type JobId = (typeof JOBS)[number];
const JOB_WORDS: Record<JobId, string> = { chat: "Chat", pictures: "Quick pictures", picturesdetailed: "Detailed pictures", videos: "Videos", music: "Music", voice: "Voice", wakeword: "Wake word", vision: "Describing pictures", coding: "Coding" };

// The state every route reads: the disk plan, the Stack's component list and the three household settings
// the cards are built from.
interface AiState {
  plan: DiskPlan;
  components: StackComponent[];
  settings: AiChoicesInput["settings"];
  freeBytes: number | null;
  list: StackComponentList;
  uncensored: Awaited<ReturnType<typeof uncensoredChoiceState>>;
  addedChats: Awaited<ReturnType<typeof addedChatChoiceStates>>;
}

function choicesInput(state: AiState): AiChoicesInput {
  return { copy: aiCopy, plan: state.plan, components: state.components, settings: state.settings, freeBytes: state.freeBytes, wakeword: wakewordAssetState(), uncensored: state.uncensored, addedChats: state.addedChats.map((added) => ({ ...added, description: ADDED_CHAT_DESCRIPTION })) };
}

function unusedInput(state: AiState): UnusedInput {
  return { copy: aiCopy, plan: state.plan, components: state.components, settings: state.settings, freeBytes: state.freeBytes, addedChats: state.addedChats.map((added) => ({ ...added, description: ADDED_CHAT_DESCRIPTION })) };
}

// The disk plan this computer's AI runs on: the Stack's own rows when it answers (previewPlan never throws;
// with no plan it says so), the shipped table of the recorded plan level before a Stack can answer.
async function loadPlan(): Promise<DiskPlan> {
  const preview = await previewPlan();
  return preview.wording.disk?.plan ?? shippedPlanForLevel(recordedLevel());
}

async function loadAiState(): Promise<AiState> {
  const [plan, list, uncensored, addedChats] = await Promise.all([loadPlan(), listStackComponents(), uncensoredChoiceState(), addedChatChoiceStates()]);
  return { plan, components: list.components, settings: readAiSettings(), freeBytes: list.free_disk_bytes, list, uncensored, addedChats };
}

// The Stack's refusal, passed through as its own sentence (routes/components.ts does the same mapping).
function failure(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  if (error instanceof StackComponentError) {
    const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 503;
    return c.json({ error: error.message, code: error.code }, status as never);
  }
  throw error;
}

// The Stack's own in-use guard is the removal guard; after a part moves, the readiness and install reads
// that cache the Stack's answer must see it gone (or back) on the next read.
function dropModelCaches(): void {
  resetInstallStatusCache();
  dropPictureStatusCache();
  dropVideoStatusCache();
  dropMusicStatusCache();
}

function writeSetting(key: string, value: unknown): { status: 400 | 403; error: string } | null {
  const written = setHouseholdSettingValue(key, value);
  return written.ok ? null : { status: written.status, error: written.error };
}

// The Stack components a choice's rows hold: the list's entry for the row (by row id or one of the row's
// models) when the list names one, or the row's first model when it does not yet.
function componentIdsFor(state: AiState, choice: AiChoice, match: (component: StackComponent) => boolean): string[] {
  const rows = new Map(state.plan.rows.map((row) => [row.id, row] as const));
  const ids: string[] = [];
  for (const rowId of choice.rowIds) {
    const row = rows.get(rowId);
    if (!row || row.kind !== "model" || row.model_ids.length === 0) continue;
    const matches = state.components.filter((component) => component.id === row.id || row.model_ids.includes(component.id));
    if (matches.length === 0) { ids.push(row.model_ids[0] ?? row.id); continue; }
    for (const component of matches.filter(match)) ids.push(component.id);
  }
  return ids;
}

// The plain name the page shows for a component (the card choice it appears in, walking the cards in their
// shown order), so the kept line says "Detailed pictures", never a model name.
function plainName(state: AiState, id: string): string {
  const rows = new Map(state.plan.rows.map((row) => [row.id, row] as const));
  const { cards } = buildAiCards(choicesInput(state));
  for (const card of cards) for (const choice of card.choices) {
    if (choice.rowIds.some((rowId) => id === rowId || (rows.get(rowId)?.model_ids.includes(id) ?? false))) return qualified(card, choice);
  }
  return plainPartName(state.components.find((component) => component.id === id) ?? {});
}

function keptMessage(name: string, reason: string): string {
  switch (reason) {
    case "You use it now.":
    case "It is in use right now.":
      return `${name} is in use now, so it was kept.`;
    case "Home needs it.":
      return `${name} is always on, so it was kept.`;
    case "Another part needs it.":
      return `Another part needs ${name}, so it was kept.`;
    case "A saved style is removed from its own page, not here.":
      return `${name} is a saved style, so it was kept. Remove it from its own page.`;
    case "A saved style needs it.":
      return `A saved style needs ${name}, so it was kept.`;
    default:
      return `${name} cannot be removed right now, so it was kept.`;
  }
}

const WAKEWORD_CHOICE = "wakeword.detector";
// The chat choices that are a chat model: picking one goes through the model switch (download, then load), not a Stack part and a setting.
const CHAT_MODEL_CHOICES = ["chat.standard", "chat.uncensored"];

// The model "Standard chat AI" means on this computer: the last catalog chat model the tier's chat row holds (its starter model comes first).
function standardChatModelId(state: AiState): string | null {
  const row = state.plan.rows.find((candidate) => candidate.id === "chat");
  const ids = (row?.model_ids ?? []).filter((id) => catalogEntries().some((model) => model.id === id && model.role === "chat" && model.implemented && !model.tags?.includes("uncensored")));
  return ids.at(-1) ?? null;
}
const SETTING_ONLY_SWITCHES: Record<string, string> = { "music.make": "generation.music.enabled", "picturesdetailed.zimage": "generation.picture_detailed.enabled" };

const SettingRefSchema = z.object({ key: z.string(), value: z.unknown() }).nullable();
const ChoiceSchema = z.object({
  id: z.string(), job: z.enum(JOBS), kind: z.enum(["radio", "switch", "fixed"]), label: z.string(), description: z.string(), name: z.string(),
  rowIds: z.array(z.string()), recommended: z.boolean(), current: z.boolean(),
  state: z.enum(["installed", "installing", "notInstalled", "failed"]), percent: z.number().nullable(), failure: z.string().nullable(),
  downloadBytes: z.number(), installedBytes: z.number(), ramBytes: z.number(), ramBasis: z.enum(["estimate", "measured"]), stateText: z.string(), blockedReason: z.string().nullable(),
  action: z.enum(["none", "use", "get", "remove"]), setting: SettingRefSchema, chosenNotReady: z.boolean(),
  details: z.array(z.object({ name: z.string(), sizeBytes: z.number() })),
});
const CardSchema = z.object({ id: z.enum(JOBS), title: z.string(), summary: z.string(), chip: z.string(), choices: z.array(ChoiceSchema), notReady: z.boolean(), unavailable: z.string().nullable() });
const AlwaysOnSchema = z.object({ bytes: z.number(), rowIds: z.array(z.string()) });
const SkippedSchema = z.object({ rowId: z.string(), label: z.string(), reason: z.string() });
const PlanSchema = z.object({
  changes: z.array(z.object({ job: z.enum(JOBS), from: z.string(), to: z.string(), setting: SettingRefSchema })),
  installRowIds: z.array(z.string()), installComponentIds: z.array(z.string()), skipped: z.array(SkippedSchema),
  downloadBytes: z.number(), fits: z.enum(["all", "some", "none"]), nothingToDo: z.boolean(), text: z.string(),
});

const refusals = errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such job or choice", 409: "It cannot be installed or removed right now (the message says why)", 503: "The engine is not answering" });

const choicesRoute = createRoute({
  method: "get", path: "/choices", tags: ["AI"], summary: "The seven job cards: every choice, which one is the household's now, which is recommended",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({
      stack: z.enum(["ok", "unreachable"]), message: z.string().nullable(),
      tier: z.string().nullable(), free_disk_bytes: z.number().nullable(), installed_bytes: z.number(),
      cards: z.array(CardSchema), alwaysOn: AlwaysOnSchema, recommended: PlanSchema.nullable(), unused_bytes: z.number(), memory_available_bytes: z.number().nullable(),
    }) } }, description: "The cards, the Always on line, the set-to-recommended plan and how much Free up space can find. With the engine down the cards are empty and the message says what to do." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(choicesRoute, async (c) => {
  let list: StackComponentList | null = null;
  let message: string | null = null;
  // The plan and the memory reading do not depend on the list: start them together so the page waits for the slowest, not the sum.
  const planned = loadPlan();
  const memory = systemAvailableBytes();
  // The two chat-model reads do not depend on the list either; waiting for them after it added their time to the page's.
  const chatStates = Promise.all([uncensoredChoiceState(), addedChatChoiceStates()]);
  chatStates.catch(() => undefined);
  try { list = await listStackComponents(); } catch (error) {
    if (error instanceof StackComponentError) message = error.message;
    else throw error;
  }
  if (list === null) {
    return c.json({ stack: "unreachable" as const, message, tier: null, free_disk_bytes: null, installed_bytes: 0, cards: [], alwaysOn: { bytes: 0, rowIds: [] }, recommended: null, unused_bytes: 0, memory_available_bytes: null }, 200);
  }
  const state: AiState = { plan: await planned, components: list.components, settings: readAiSettings(), freeBytes: list.free_disk_bytes, list, uncensored: (await chatStates)[0], addedChats: (await chatStates)[1] };
  const { cards, alwaysOn } = buildAiCards(choicesInput(state));
  return c.json({
    stack: "ok" as const, message: null, tier: list.tier, free_disk_bytes: list.free_disk_bytes, installed_bytes: list.installed_bytes,
    cards, alwaysOn, recommended: recommendedPlan(choicesInput(state)), unused_bytes: findUnused(unusedInput(state)).totalBytes, memory_available_bytes: (await memory)?.available ?? null,
  }, 200);
});

const TIER_STACK_CATEGORY: Record<string, TierStackCategory> = { chat: "chat", pictures: "pictures", videos: "video", music: "music", voice: "voice" };
const MAX_RUNNING_LINE = "A Max job is running and everything big waits. Stop it to give the room back; chat returns to normal.";
const windowRoute = createRoute({
  method: "get", path: "/tier-window", tags: ["AI"], summary: "Whether a Max job holds the computer, what each category does meanwhile and which apps were closed, for admins only (TIER-HOME-03, TIER-PRIO-05)",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ open: z.boolean(), minutes_left: z.number().int().nullable(), line: z.string().nullable(), profile: z.string().nullable(), closed_apps: z.array(z.string()) }) } }, description: "The open Max window, if any." }, ...refusals },
});
aiChoicesRoutes.openapi(windowRoute, (c) => {
  const open = openMaxWindow();
  return c.json({ open: open !== null, minutes_left: open?.minutesLeft ?? null, line: open ? MAX_RUNNING_LINE : null, profile: activeProfileLine(), closed_apps: closedAppsLines() }, 200);
});
const stopWindowRoute = createRoute({
  method: "post", path: "/tier-window/stop", tags: ["AI"], summary: "Stop the running Max job so the room and chat come back (TIER-HOME-03)",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ stopped: z.boolean() }) } }, description: "True when a Max job was running and has been stopped." }, ...refusals },
});
aiChoicesRoutes.openapi(stopWindowRoute, async (c) => c.json({ stopped: await endMaxWindow() }, 200));

const tiersRoute = createRoute({
  method: "get", path: "/tiers/{job}", tags: ["AI"], summary: "The models each level of a job may use on this computer, by family, with what fits each level's cap (TIER-HOME-04)",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ job: z.enum(["chat", "pictures", "videos", "music", "voice"]).openapi({ param: { name: "job", in: "path" } }) }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      profile: z.string().nullable(), room_bytes: z.number(),
      levels: z.array(z.object({ tier: z.enum(["standard", "boost", "max"]), cap_bytes: z.number(), recommended: z.string().nullable(), candidates: z.array(z.object({ id: z.string(), label: z.string(), family: z.string(), peak_bytes: z.number(), verified: z.boolean(), fits: z.boolean(), refusal: z.string().nullable() })) })),
    }) } }, description: "Every catalog candidate under Standard, Boost and Max, the family it belongs to, and the plain refusal when it does not fit that level." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(tiersRoute, async (c) => {
  try {
    const found = await listTierCandidates(TIER_STACK_CATEGORY[c.req.valid("param").job]!);
    return c.json({ profile: found.profile, room_bytes: found.room_bytes, levels: found.levels }, 200);
  } catch (error) {
    if (error instanceof StackComponentError) return c.json({ error: error.message, code: error.code }, 503) as never;
    throw error;
  }
});

const unusedRoute = createRoute({
  method: "get", path: "/unused", tags: ["AI"], summary: "The installed parts nothing uses, the space they free and the plain reason",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({
      items: z.array(z.object({ id: z.string(), name: z.string(), bytes: z.number(), reason: z.string(), lastUsedAt: z.string().nullable() })),
      total_bytes: z.number(),
    }) } }, description: "The Free up space list, largest first. A saved style is never listed." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(unusedRoute, async (c) => {
  try {
    const { items, totalBytes } = findUnused(unusedInput(await loadAiState()));
    return c.json({ items, total_bytes: totalBytes }, 200);
  } catch (error) { return failure(c, error) as never; }
});

const chooseRoute = createRoute({
  method: "post", path: "/choices/{job}", tags: ["AI"], summary: "Make one choice the household's: download it first when it is missing, then write the setting",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    params: z.object({ job: z.string().min(1).max(20) }),
    body: { required: true, content: { "application/json": { schema: z.object({ choice: z.string().min(1).max(120) }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), started: z.array(z.string()), removed: z.array(z.string()) }) } }, description: "What started downloading (a job or a part), or what was removed. The setting is written only after the install can start." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(chooseRoute, async (c) => {
  const job = c.req.valid("param").job;
  const { choice: choiceId } = c.req.valid("json");
  if (!JOBS.includes(job as JobId)) return c.json({ error: `No such job: ${job}.`, code: "unknown_job" }, 404);
  try {
    const state = await loadAiState();
    const { cards } = buildAiCards(choicesInput(state));
    const choice = cards.find((card) => card.id === (job as JobId))?.choices.find((item) => item.id === choiceId);
    if (!choice) return c.json({ error: `There is no choice called "${choiceId}" on this computer.`, code: "unknown_choice" }, 404);
    if (choice.id === WAKEWORD_CHOICE) {
      // The wake word files are the hub's own pinned downloads, not Stack parts: a few megabytes, fetched or removed here.
      // Listening stays off until an adult turns it on for a device; nothing here touches that.
      if (choice.action === "get") {
        try { await ensureWakewordAssets(); } catch {
          return c.json({ error: "The wake word files did not download. Check that this computer is online, then try again.", code: "wakeword_download" }, 503) as never;
        }
        return c.json({ ok: true as const, started: [], removed: [] }, 200);
      }
      if (choice.action === "remove") { removeWakewordAssets(); return c.json({ ok: true as const, started: [], removed: [choice.id] }, 200); }
    }
    if ((CHAT_MODEL_CHOICES.includes(choice.id) || choice.id.startsWith("chat.added.")) && (choice.action === "get" || choice.action === "use")) {
      const modelId = choice.id === "chat.uncensored" ? state.uncensored?.id ?? null
        : choice.id.startsWith("chat.added.") ? state.addedChats.find((added) => `chat.added.${added.id}` === choice.id)?.id ?? null
        : standardChatModelId(state);
      if (!modelId) return c.json({ error: "That chat model is not available on this computer.", code: "unknown_choice" }, 404) as never;
      const started = await startChatModelChoice(modelId);
      if ("error" in started) return c.json({ error: started.error, code: "chat_model" }, started.status === 404 ? 404 : started.status === 409 ? 409 : 503) as never;
      dropModelCaches();
      return c.json({ ok: true as const, started: started.jobs ?? [], removed: [] }, 200);
    }
    if (choice.action === "get") {
      // Download first, then the setting: a choice is never set to something that is missing.
      const started: string[] = [];
      for (const id of componentIdsFor(state, choice, (part) => part.state !== "installed")) {
        started.push((await installStackComponent(id)).job ?? id);
      }
      if (choice.setting) {
        const error = writeSetting(choice.setting.key, choice.setting.value);
        if (error) return c.json({ error: error.error, code: "setting" }, error.status) as never;
      }
      if (started.length > 0) dropModelCaches();
      return c.json({ ok: true as const, started, removed: [] }, 200);
    }
    if (choice.action === "use") {
      if (choice.setting) {
        const error = writeSetting(choice.setting.key, choice.setting.value);
        if (error) return c.json({ error: error.error, code: "setting" }, error.status) as never;
      }
      return c.json({ ok: true as const, started: [], removed: [] }, 200);
    }
    if (choice.action === "remove") {
      // A person turned their own switch off (music, Detailed pictures): it stays on the computer, only the setting changes.
      if (choice.id in SETTING_ONLY_SWITCHES) {
        const error = writeSetting(SETTING_ONLY_SWITCHES[choice.id]!, false);
        if (error) return c.json({ error: error.error, code: "setting" }, error.status) as never;
        return c.json({ ok: true as const, started: [], removed: [] }, 200);
      }
      const removed: string[] = [];
      for (const id of componentIdsFor(state, choice, (part) => part.state === "installed")) {
        if ((await uninstallStackComponent(id)).removed) removed.push(id);
      }
      if (removed.length > 0) dropModelCaches();
      return c.json({ ok: true as const, started: [], removed }, 200);
    }
    return c.json({ error: choice.blockedReason ?? (choice.state === "installing" ? "It is still installing." : "It is already the choice."), code: "no_action" }, 409);
  } catch (error) { return failure(c, error) as never; }
});

const recommendedRoute = createRoute({
  method: "post", path: "/recommended", tags: ["AI"], summary: "Set everything to recommended: write the choices and start the missing downloads, never remove",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { required: false, content: { "application/json": { schema: z.object({}) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      ok: z.literal(true),
      changed: z.array(z.string()),
      started: z.array(z.string()),
      already: z.array(z.string()),
      skipped: z.array(SkippedSchema),
      needs_licence: z.array(z.object({ id: z.string(), label: z.string() })),
    }) } }, description: "The choice changes made, the downloads started, the parts already installed or downloading, the skipped ones and the parts that wait for a licence click. Safe to press twice; it never removes anything." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(recommendedRoute, async (c) => {
  try {
    const state = await loadAiState();
    const plan = recommendedPlan(choicesInput(state));
    const changed: string[] = [];
    for (const change of plan.changes) {
      if (!change.setting) continue;
      const error = writeSetting(change.setting.key, change.setting.value);
      if (error) return c.json({ error: error.error, code: "setting" }, error.status) as never;
      changed.push(`${JOB_WORDS[change.job]}: ${change.from} to ${change.to}`);
    }
    const started: string[] = [];
    const already: string[] = [];
    const needsLicence: Array<{ id: string; label: string }> = [];
    for (const id of plan.installComponentIds) {
      const part = state.components.find((component) => component.id === id);
      // Safe to press twice: an install is started only for a part that is not installed and has no job running.
      if (part && (part.state === "installed" || part.state === "installing" || part.job !== null)) { already.push(id); continue; }
      try {
        started.push((await installStackComponent(id)).job ?? id);
      } catch (error) {
        // A part whose licence needs a click stops that one item at the existing licence prompt; the rest continue.
        if (error instanceof StackComponentError && part?.licence) { needsLicence.push({ id, label: part.label }); continue; }
        throw error;
      }
    }
    if (started.length > 0) dropModelCaches();
    return c.json({ ok: true as const, changed, started, already, skipped: plan.skipped, needs_licence: needsLicence }, 200);
  } catch (error) { return failure(c, error) as never; }
});

const cleanupRoute = createRoute({
  method: "post", path: "/cleanup", tags: ["AI"], summary: "Remove the chosen unused parts and free their space; one failure never stops the rest",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { required: true, content: { "application/json": { schema: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(20) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      results: z.array(z.object({ id: z.string(), status: z.enum(["removed", "kept", "failed"]), freed_bytes: z.number(), message: z.string() })),
      freed_bytes: z.number(), kept: z.number(), failed: z.number(),
    }) } }, description: "One line per id, in the order sent: removed with its bytes, kept with the plain reason, failed with the engine's sentence." },
    ...refusals,
  },
});
aiChoicesRoutes.openapi(cleanupRoute, async (c) => {
  const { ids } = c.req.valid("json");
  let state: AiState;
  const results: Array<{ id: string; status: "removed" | "kept" | "failed"; freed_bytes: number; message: string }> = [];
  let freed = 0;
  let kept = 0;
  let failed = 0;
  for (const id of ids) {
    // Fresh state for every id: the one before it may have moved a part, and a part that became used since
    // the list was read must be seen as used.
    try { state = await loadAiState(); } catch (error) { return failure(c, error) as never; }
    // The unused test runs again per id at removal time: a part that became used since the list was read
    // is kept, and said so.
    const reason = whyKept(unusedInput(state), id);
    if (reason !== null) {
      results.push({ id, status: "kept", freed_bytes: 0, message: keptMessage(plainName(state, id), reason) });
      kept += 1;
      continue;
    }
    try {
      const removed = await uninstallStackComponent(id);
      if (removed.removed) freed += removed.freed_bytes;
      results.push({ id, status: "removed", freed_bytes: removed.freed_bytes, message: "" });
    } catch (error) {
      if (error instanceof StackComponentError) {
        results.push({ id, status: "failed", freed_bytes: 0, message: error.message });
        failed += 1;
        continue;
      }
      throw error;
    }
  }
  if (freed > 0) dropModelCaches();
  return c.json({ results, freed_bytes: freed, kept, failed }, 200);
});

const SourceBody = z.object({ source: z.string().trim().min(1).max(500), file: z.string().trim().min(1).max(300).optional() });
const InspectedSchema = z.object({
  repo: z.string(), file: z.string(), sizeBytes: z.number(), sha256: z.string(), licence: z.string().nullable(), architecture: z.string(),
  verifiedArchitecture: z.boolean(), ramBytes: z.number(), fits: z.enum(["fits", "estimate"]).describe("fits: the architecture is one MaiPai has verified; estimate: the dry run decides before load"),
});
const addRefusals = errorResponses({ 400: "The link or file cannot be added (the message says why)", 401: "Not signed in", 403: "Admins only", 409: "It cannot be added right now (the message says why)", 502: "The engine did not answer" });

function addFailure(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  if (error instanceof AddModelError) return c.json({ error: error.message, code: "add_model" }, error.status as never);
  throw error;
}

const inspectRoute = createRoute({
  method: "post", path: "/models/inspect", tags: ["AI"], summary: "Read a pasted Hugging Face model link: size, checksum, licence and architecture, without downloading it",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { required: true, content: { "application/json": { schema: SourceBody } } } },
  responses: { 200: { content: { "application/json": { schema: InspectedSchema } }, description: "What the repository states about the file." }, ...addRefusals },
});
aiChoicesRoutes.openapi(inspectRoute, async (c) => {
  const { source, file } = c.req.valid("json");
  try {
    const found = await inspectForAdd(source, file);
    return c.json({ repo: found.repo, file: found.file, sizeBytes: found.sizeBytes, sha256: found.sha256, licence: found.licence, architecture: found.architecture, verifiedArchitecture: found.verifiedArchitecture, ramBytes: found.ramBytes, fits: found.verifiedArchitecture ? "fits" as const : "estimate" as const }, 200);
  } catch (error) { return addFailure(c, error) as never; }
});

const addRoute = createRoute({
  method: "post", path: "/models/add", tags: ["AI"], summary: "Add the chat model a pasted link names: store its record, download it (hash checked) and use it",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { required: true, content: { "application/json": { schema: SourceBody } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), id: z.string(), label: z.string(), jobs: z.array(z.string()) }) } }, description: "The model is stored and its download (or load) has started." }, ...addRefusals },
});
aiChoicesRoutes.openapi(addRoute, async (c) => {
  const { source, file } = c.req.valid("json");
  try {
    const added = await addChatModel(source, file, c.get("person").id);
    dropModelCaches();
    return c.json({ ok: true as const, id: added.id, label: added.label, jobs: added.state.jobs ?? [] }, 200);
  } catch (error) { return addFailure(c, error) as never; }
});
