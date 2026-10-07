import { Hono } from "hono";
import { requireAuth, requireRole } from "@/middleware/auth";
import { detectHardware } from "@/lib/hardware";
import { recommend, CATALOG, thinkingModeFor } from "@/lib/modelCatalog";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { getEngineStatsSamples } from "@/lib/engineStats";
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { AppEnv } from "@/types";
import type { ChatCapabilities } from "@/wire";
import { chatModelReadsPictures, picturePartsAllowed } from "@/lib/chatPictures";
import { speakerAgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";

export const hostRoutes = new Hono<AppEnv>();

// Owner/admin only: this is host-level operational data (what hardware is
// in the box, what model runs), the same posture backups.ts takes, not a
// per-person preference.
hostRoutes.get("/hardware", requireRole("owner", "admin"), async (c) => c.json(await detectHardware()));

const VALID_ROLES: ReadonlySet<string> = new Set(ModelCapabilities.shape.role.options);

hostRoutes.get("/models", requireRole("owner", "admin"), async (c) => {
  const role = c.req.query("role");
  if (!role || !VALID_ROLES.has(role)) {
    return c.json({ error: `role must be one of: ${[...VALID_ROLES].join(", ")}` }, 400);
  }
  const hw = await detectHardware();
  return c.json(recommend(role as (typeof CATALOG)[number]["role"], hw));
});

// The compact chat-facing list deliberately has a different boundary from
// the owner diagnostics route above. Adults see the Stack chat role and its
// selected model without host diagnostics; a child gets the empty safe shape.
hostRoutes.get("/chat-models", requireAuth, async (c) => {
  const actor = c.get("person");
  if (speakerAgeBand(actor, new Date()) !== "adult") {
    return c.json({ models: [], selectedModel: null, canSelect: false as const });
  }

  // Chat model information comes from the Stack. Hardware fit details stay
  // on the owner diagnostics route.
  const stackChat = await readStackChatRole();
  const models = stackChat?.models?.map((model) => ({ id: model.id, label: model.name })) ?? [];
  const currentId = stackChat?.model?.id ?? null;
  const selected = currentId ? stackChat?.models?.find((model) => model.id === currentId) : undefined;
  return c.json({
    models,
    selectedModel: selected ? { id: selected.id, label: selected.name, available: true } : currentId ? { id: currentId, label: stackChat?.model?.id ?? currentId, available: true } : null,
    canSelect: false,
  });
});

// VISION-02c: the one place the composer learns whether this person's
// pictures go to the chat model (chatPictures.ts decides; never a model id).
hostRoutes.get("/chat-capabilities", requireAuth, async (c) => {
  const actor = c.get("person");
  const capability = await chatModelReadsPictures();
  const stackChat = await readStackChatRole();
  const minor = speakerAgeBand(actor, new Date()) !== "adult";
  const current = stackChat?.model?.id ?? (getHouseholdSettingValue("chat.model_id") as string | undefined);
  const thinking_modes = Object.fromEntries((stackChat?.models ?? []).map((model) => [model.id, minor ? "none" as const : thinkingModeFor(model.id)]));
  const body: ChatCapabilities = { image_parts: picturePartsAllowed(capability, actor), thinking: minor ? "none" : thinkingModeFor(current), thinking_modes };
  return c.json(body);
});

// Additive Stack chat selection and state for Home settings surfaces.
hostRoutes.get("/models/selection", requireRole("owner", "admin"), async (c) => {
  const chat = await readStackChatRole();
  return c.json({ modelId: chat?.model?.id ?? null, name: chat?.models?.find((m) => m.id === chat.model?.id)?.name ?? null, state: chat?.state?.state ?? "offline" });
});

async function readStackChatRole() {
  if (!isStackConfigured()) return null;
  try { return (await getStackClient().roles()).roles.find((role) => role.id === "chat") ?? null; }
  catch { return null; }
}

// Home no longer starts chat model downloads.
hostRoutes.post("/models/:id/select", requireRole("owner", "admin"), async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});

hostRoutes.get("/models/:id/select-status", requireRole("owner", "admin"), async (c) => {
  const id = c.req.param("id");
  return c.json({ modelId: id, status: "none" });
});

// Engine control ("do we need ways to see if llama and everything is
// running, pause or stop it, restart" - Jesse, 2026-09-04) and the
// resource-trend view alongside it.
hostRoutes.get("/engine/status", requireRole("owner", "admin"), async (c) => {
  const chat = await readStackChatRole();
  const kind = chat?.state.state === "ready" || chat?.state.state === "installed" ? "url" : chat?.state.state === "loaded" ? "starting" : "none";
  const modelId = chat?.model?.id ?? null;
  const name = chat?.models?.find((model) => model.id === modelId)?.name ?? modelId;
  // pid and startedAt remain for wire compatibility with fixed values because Home does not own this process.
  return c.json({ kind, modelId, pid: null, startedAt: null, name, state: chat?.state.state ?? "offline" });
});

hostRoutes.get("/engine/stats", requireRole("owner", "admin"), async (c) => c.json(getEngineStatsSamples()));

hostRoutes.post("/engine/stop", requireRole("owner", "admin"), async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});

hostRoutes.post("/engine/restart", requireRole("owner", "admin"), async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});

// Restarts the whole hub process ("restart the entire server, under
// Settings -> Household, next to the app's health" - Jesse, 2026-09-07),
// not just the chat engine above. Every real install runs under an OS
// service manager (scripts/install.sh's systemd unit and launchd
// LaunchDaemon, install.ps1's WinSW service) that brings the process
// back the moment it exits, so this route's only job is to exit and let
// that supervisor do the actual restart - the same "process supervision
// is the OS service manager's job, not app code" boundary docs/
// BACKLOG.md already draws for self-update, applied here too instead of
// reimplementing it by shelling out to systemctl/launchctl/WinSW.
// A non-zero code, not the 0 a plain Ctrl-C/systemctl-stop uses
// (index.ts's SIGINT/SIGTERM handlers): systemd's `Restart=on-failure`
// and WinSW's `<onfailure>` only restart on a non-zero exit, so exit(0)
// here would just stop the hub instead of restarting it (launchd's
// `KeepAlive=true` restarts on any exit, so this stays correct there
// too). The sidecar and Wyoming-server cleanup those signal handlers run
// already fires regardless of exit code - sidecars.ts's and
// denoHost.ts's registerGracefulExit() and index.ts's own Wyoming
// shutdown all hook `process.on("exit", ...)`, which runs no matter how
// the process ends - so nothing extra needs calling here.
export const RESTART_EXIT_CODE = 75;

hostRoutes.post("/restart", requireRole("owner", "admin"), async (c) => {
  const response = c.json({ ok: true as const, restarting: true as const });
  // Delayed past this handler's return so the response above actually
  // reaches the browser before the process exits, the same reasoning as
  // any "tell the client, then do the disruptive thing" action.
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 200);
  return response;
});
