import { Hono } from "hono";
import { requireRole } from "@/middleware/auth";
import { detectHardware } from "@/lib/hardware";
import { recommend, CATALOG } from "@/lib/modelCatalog";
import { getJob, startSelectJob } from "@/lib/modelDownloadJobs";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getChatClient, getEngineStatus, restartChatBackend, stopChatBackend } from "@/lib/llmSupervisor";
import { getEngineStatsSamples } from "@/lib/engineStats";
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { AppEnv } from "@/types";

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

// Which chat model (if any) the household has actually chosen, for
// ModelsSection.tsx to know which card to mark "in use" without polling a
// job that may not exist yet (a freshly-selected model that finished
// downloading in a previous session has no running job any more).
hostRoutes.get("/models/selection", requireRole("owner", "admin"), async (c) => {
  const modelId = (getHouseholdSettingValue("chat.model_id") as string) || null;
  return c.json({ modelId });
});

// Starts (or returns the already-running) download-and-select job for one
// catalog model id (modelDownloadJobs.ts). Fire-and-poll: this returns
// immediately with the job's current row, GET .../select-status keeps
// returning fresher rows as the job progresses.
hostRoutes.post("/models/:id/select", requireRole("owner", "admin"), async (c) => {
  const id = c.req.param("id");
  const model = CATALOG.find((m) => m.id === id && m.role === "chat");
  if (!model) return c.json({ error: `unknown chat model: ${id}` }, 404);
  if (!model.implemented) return c.json({ error: `${id} has no real backend yet` }, 400);
  try {
    return c.json(startSelectJob(id));
  } catch (err) {
    // A different model is already mid-select (modelDownloadJobs.ts's
    // one-job-at-a-time gate) - a real, expected conflict, not a crash.
    return c.json({ error: (err as Error).message }, 409);
  }
});

hostRoutes.get("/models/:id/select-status", requireRole("owner", "admin"), async (c) => {
  const id = c.req.param("id");
  const job = getJob(id);
  if (!job) return c.json({ modelId: id, status: "none" });
  return c.json(job);
});

// Engine control ("do we need ways to see if llama and everything is
// running, pause or stop it, restart" - Jesse, 2026-09-04) and the
// resource-trend view alongside it.
hostRoutes.get("/engine/status", requireRole("owner", "admin"), async (c) => c.json(getEngineStatus()));

hostRoutes.get("/engine/stats", requireRole("owner", "admin"), async (c) => c.json(getEngineStatsSamples()));

hostRoutes.post("/engine/stop", requireRole("owner", "admin"), async (c) => {
  stopChatBackend();
  return c.json(getEngineStatus());
});

// Synchronous, not a polled job like .../select: restarting an
// already-downloaded model only re-spawns and re-runs the post-load
// check (seconds), not a multi-GB download, so one request/response is
// the honest shape rather than inventing a second progress-polling path
// for a much shorter wait.
// A code review of the live incident this same night (2026-09-04): a
// hung getChatClient() used to hold this HTTP response open indefinitely
// - the browser's own fetch has no default timeout either, so the page
// showed "Starting..." forever with no way to recover short of a full
// reload. This bounds the wait: past RESTART_TIMEOUT_MS the route
// answers with a clear timeout error instead of hanging - the underlying
// spawn attempt isn't cancelled (there's no cooperative-cancellation
// story for a llama-server health-check loop), so if it does eventually
// succeed, the next status poll picks it up; if it doesn't, the household
// member gets a real error and a Restart button to try again rather than
// a spinner with no way out.
const RESTART_TIMEOUT_MS = 90_000;

hostRoutes.post("/engine/restart", requireRole("owner", "admin"), async (c) => {
  await restartChatBackend();
  // A code review (2026-09-04) found the timer here was never cleared
  // once the race settled, keeping a live setTimeout handle (and the
  // event loop) alive for up to 90s after a fast, successful restart -
  // harmless (its callback just rejects an already-settled race), but a
  // real handle leak on every single restart call. Cleared in `finally`
  // regardless of which side of the race won.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getChatClient(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`timed out waiting for the chat engine after ${RESTART_TIMEOUT_MS / 1000}s`)),
          RESTART_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  } finally {
    clearTimeout(timeoutHandle);
  }
  return c.json(getEngineStatus());
});
