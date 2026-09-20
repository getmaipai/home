// The wake-word pipeline's asset routes (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Any signed-in person, no role gate:
// these are static model bytes and a list of what's available, the same
// posture /api/llm/chat and /api/tts already take for their own
// non-privileged reads.
import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "@/middleware/auth";
import {
  WAKEWORD_ALL_ASSETS,
  WAKEWORD_STOCK_DETECTOR,
  ensureWakewordAssets,
  wakewordAssetPath,
} from "@/lib/wakewordAssets";
import { getVoiceCatalog, isVoiceCatalogPath } from "@/lib/voiceCatalog";
import { setPersonTtsVoiceUnchecked, setValue, resetValue, resolveForResponse } from "@/lib/settings";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { getStackUrl, getStackClient, stackFailureResult } from "@/lib/stackEngine";
import { isOwnerOrAdmin } from "@/lib/access";
import { ResolvedSettingSchema } from "@/routes/settings";
import { restartTtsBackend } from "@/lib/ttsSupervisor";
import {
  listClonedVoices,
  saveClonedVoice,
  deleteClonedVoice,
  getClonedVoiceFile,
  clonedVoiceExists,
  clonedVoiceUrl,
  MAX_BYTES as MAX_CLONED_VOICE_BYTES,
} from "@/lib/clonedVoices";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses } from "@/lib/openapi";

export const voiceRoutes = apiRouter();

// What the browser pipeline should load: the shared stage file names plus
// every available per-phrase detector, so the frontend registry
// (frontend/src/lib/voice/wake-word-models.ts) has one real source
// instead of a second, hand-duplicated copy of this list.
const wakewordsRoute = createRoute({
  method: "get",
  path: "/wakewords",
  tags: ["Voice"],
  summary: "List available wake-word detectors",
  description:
    "The fixed list of wake-word detectors the browser pipeline can load. " +
    "Returns the shared stage file names and every available per-phrase detector.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            detectors: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                file: z.string(),
              }),
            ),
          }),
        },
      },
      description: "The list of available wake-word detectors.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

voiceRoutes.openapi(wakewordsRoute, async (c) => {
  return c.json(
    { detectors: [{ id: "hey_jarvis", label: "openWakeWord \"hey jarvis\"", file: WAKEWORD_STOCK_DETECTOR.file }] },
    200,
  );
});

// A fixed allow-list, never a path built from the request: `:file` only
// ever selects one of the pinned assets this module already knows about,
// so there is no path-traversal surface here regardless of what a caller
// sends.
const ASSET_BY_FILE = new Map(WAKEWORD_ALL_ASSETS.map((a) => [a.file, a]));

const wakewordFileRoute = createRoute({
  method: "get",
  path: "/wakeword/:file",
  tags: ["Voice"],
  summary: "Download a wake-word asset file",
  description:
    "Serves the bytes of one pinned wake-word asset by file name. " +
    "`:file` only ever selects one of the fixed assets this module knows about; " +
    "there is no path-traversal surface.",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ file: z.string() }),
  },
  responses: {
    200: {
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
      description: "The raw asset file bytes.",
    },
    ...errorResponses({ 401: "Not signed in", 404: "Unknown wake-word asset", 503: "Asset unavailable" }),
  },
});

voiceRoutes.openapi(wakewordFileRoute, async (c) => {
  const file = c.req.valid("param").file;
  const asset = ASSET_BY_FILE.get(file);
  if (!asset) return c.json({ error: `unknown wake-word asset: ${file}` }, 404);

  try {
    await ensureWakewordAssets();
  } catch (err) {
    return c.json({ error: `wake-word asset unavailable: ${(err as Error).message}` }, 503);
  }

    const bunFile = Bun.file(wakewordAssetPath(asset.file));
  return new Response(bunFile, { status: 200, headers: { "content-type": "application/octet-stream" } });
});

// The full community voice catalog (2026-09-04, item 3 of the Pocket TTS
// follow-ups): every real file in `kyutai/tts-voices`, not just the 26
// bundled presets. ~2,069 short path strings - small enough to hand back
// in one response and let the browser search/group client-side rather
// than build server-side pagination for it.
const voiceCatalogRoute = createRoute({
  method: "get",
  path: "/catalog",
  tags: ["Voice"],
  summary: "List the community voice catalog",
  description:
    "Every real file in the kyutai/tts-voices Hugging Face repo, not just the " +
    "bundled presets. Returns path strings the browser can search and group client-side.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            entries: z.array(
              z.object({
                path: z.string(),
                collection: z.string(),
              }),
            ),
          }),
        },
      },
      description: "The list of voice catalog entries.",
    },
    ...errorResponses({ 401: "Not signed in", 503: "Voice catalog unavailable" }),
  },
});

voiceRoutes.openapi(voiceCatalogRoute, async (c) => {
  try {
    const entries = await getVoiceCatalog();
    return c.json({ entries }, 200);
  } catch (err) {
    return c.json({ error: `voice catalog unavailable: ${(err as Error).message}` }, 503);
  }
});

// Sets the signed-in person's OWN tts.voice_id to a catalog pick -
// never another person's, `actor` comes from the session, not the
// request body. `path` is checked against the REAL, live-fetched
// catalog (not just a shape check) before it's ever written: this is
// the one place `tts.voice_id` can hold something outside its normal
// 26-name option list, so the validation that matters has to happen
// here, not in the generic PUT /api/settings route (which would reject
// it outright - see lib/settings.ts's setPersonTtsVoiceUnchecked() for
// why that's deliberate).
const catalogSelectRoute = createRoute({
  method: "post",
  path: "/catalog/select",
  tags: ["Voice"],
  summary: "Select a voice from the community catalog",
  description:
    "Sets the signed-in person's own tts.voice_id to a voice picked from the " +
    "community catalog. The path is validated against the live-fetched catalog " +
    "before it is written.",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ path: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema } },
      description: "The updated person record.",
    },
    ...errorResponses({ 400: "Invalid or unknown path, or unknown settings key", 401: "Not signed in", 403: "Not allowed", 503: "Voice catalog unavailable" }),
  },
});

voiceRoutes.openapi(catalogSelectRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const path = body.path;
  let entries;
  try {
    entries = await getVoiceCatalog();
  } catch (err) {
    return c.json({ error: `voice catalog unavailable: ${(err as Error).message}` }, 503);
  }
  if (!isVoiceCatalogPath(entries, path)) {
    return c.json({ error: `not a real voice catalog entry: ${path}` }, 400);
  }
  const result = setPersonTtsVoiceUnchecked(actor, `hf://kyutai/tts-voices/${path}`);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 200);
});

// voice.hf_token has a side effect the generic PUT /api/settings route has
// no hook for: an already-running `pocket-tts serve` process read this
// setting once, at spawn time, and never again, so a saved or removed
// token only takes effect once ttsSupervisor.ts's cache is cleared and the
// next call re-spawns. This mirrors chat.model_id's own dedicated-route
// precedent (routes/host.ts's startSelectJob, for the identical reason -
// a setting change here needs a spawn side effect a plain write can't
// carry). setValue()/resetValue() are the same actor-gated functions the
// generic route itself calls, so the owner/admin check for a household
// key is enforced exactly once, in lib/settings.ts, not re-implemented
// here as a second requireRole gate that could drift from it.
const hfTokenRoute = createRoute({
  method: "post",
  path: "/hf-token",
  tags: ["Voice"],
  summary: "Save a Hugging Face API token",
  description:
    "Saves the household's voice.hf_token and restarts the TTS backend so the " +
    "new token takes effect on the next TTS call.",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ token: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema } },
      description: "The updated setting record.",
    },
    ...errorResponses({ 400: "Token is required, or unknown settings key", 401: "Not signed in", 403: "Not allowed", 503: "The Stack did not answer" }),
  },
});

voiceRoutes.openapi(hfTokenRoute, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const token = body.token.trim();
  if (!token) {
    return c.json({ error: "token is required" }, 400);
  }

  // HOME-STACK-02b: a Stack owns its own tts engine and the token it
  // needs to clone a voice, so a configured Stack gets the write
  // instead of Home's own env-fed TTS process - Home's household
  // voice.hf_token key is never populated at all in this mode (there is
  // nothing here for it to feed). Same owner/admin gate as the
  // household-setting path below (setValue()'s own assertCanAccessScope) -
  // this branch bypasses setValue() entirely, so the check has to be
  // made explicitly here instead of inherited from it.
  if (getStackUrl()) {
    if (!isOwnerOrAdmin(actor)) {
      return c.json({ error: "only owner or admin may change household settings" }, 403);
    }
    try {
      await getStackClient().applySettings({ "stack.engines.tts.hf_token": token });
    } catch (err) {
      const failure = stackFailureResult(err, "tts");
      return c.json({ error: failure.error }, failure.status);
    }
    return c.json(resolveForResponse(getRegistryKey("voice.hf_token")!, token, "user"), 200);
  }

  const result = setValue(actor, "household", "voice.hf_token", token);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  await restartTtsBackend();
  return c.json(result.value, 200);
});

const hfTokenRemoveRoute = createRoute({
  method: "post",
  path: "/hf-token/remove",
  tags: ["Voice"],
  summary: "Remove the Hugging Face API token",
  description:
    "Removes the household's voice.hf_token and restarts the TTS backend.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema } },
      description: "The updated setting record.",
    },
    ...errorResponses({ 400: "Unknown settings key", 401: "Not signed in", 403: "Not allowed", 503: "The Stack did not answer" }),
  },
});

voiceRoutes.openapi(hfTokenRemoveRoute, async (c) => {
  const actor = c.get("person");
  if (getStackUrl()) {
    if (!isOwnerOrAdmin(actor)) {
      return c.json({ error: "only owner or admin may change household settings" }, 403);
    }
    try {
      await getStackClient().applySettings({ "stack.engines.tts.hf_token": "" });
    } catch (err) {
      const failure = stackFailureResult(err, "tts");
      return c.json({ error: failure.error }, failure.status);
    }
    return c.json(resolveForResponse(getRegistryKey("voice.hf_token")!, "", "default"), 200);
  }

  const result = resetValue(actor, "household", "voice.hf_token");
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  await restartTtsBackend();
  return c.json(result.value, 200);
});

// Voice cloning (2026-09-04, the follow-up to voice.hf_token): a real
// audio sample a household member uploaded, not the community catalog's
// pre-existing files. Household-wide list, same visibility as the
// catalog's own selection - see lib/clonedVoices.ts's own comment.
const clonedListRoute = createRoute({
  method: "get",
  path: "/cloned",
  tags: ["Voice"],
  summary: "List cloned voices",
  description:
    "The household-wide list of cloned voices, each with its label, file " +
    "size, MIME type, and creation timestamp.",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            voices: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                creatorId: z.string(),
                creatorName: z.string(),
                bytes: z.number().int().nonnegative(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
      description: "The list of cloned voices.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

voiceRoutes.openapi(clonedListRoute, async (c) => {
  return c.json({ voices: listClonedVoices() }, 200);
});

// bodyLimit rejects an oversized request as its bytes arrive (checking
// Content-Length up front when present, otherwise counting a streamed
// body chunk by chunk) rather than after: a code review (2026-09-04)
// found the route buffered the WHOLE upload into memory via parseBody()
// and file.arrayBuffer() before saveClonedVoice()'s own 20MB check ever
// ran, so that check only ever bounded disk usage, not the memory a
// hostile or mistaken multi-gigabyte upload could consume first - and
// this route has no role gate, so any signed-in household member
// (including a child) could trigger it. A margin over the real cap
// (multipart boundaries and the label field add a little overhead) so a
// legitimate MAX_CLONED_VOICE_BYTES file is never rejected here only to
// pass saveClonedVoice()'s own check moments later.
const clonedUploadRoute = createRoute({
  method: "post",
  path: "/cloned",
  tags: ["Voice"],
  summary: "Upload a cloned voice",
  description:
    "Uploads a real audio sample as a new cloned voice. Accepts a multipart " +
    "form with a file field (the audio) and a label field (a display name). " +
    "The upload is bounded by bodyLimit to prevent multi-gigabyte memory use.",
  middleware: [requireAuth, bodyLimit({ maxSize: MAX_CLONED_VOICE_BYTES + 64 * 1024 })] as const,
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.unknown(),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            label: z.string(),
            creatorId: z.string(),
            creatorName: z.string(),
            bytes: z.number().int().nonnegative(),
            createdAt: z.string(),
          }),
        },
      },
      description: "The newly saved cloned voice record.",
    },
    ...errorResponses({ 400: "Missing file or label", 401: "Not signed in", 403: "Not allowed", 404: "Unknown voice" }),
  },
});

voiceRoutes.openapi(clonedUploadRoute, async (c) => {
  const actor = c.get("person");
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const file = body.file;
  const label = body.label;
  if (!(file instanceof File)) return c.json({ error: "an audio file is required" }, 400);
  if (typeof label !== "string") return c.json({ error: "label is required" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = saveClonedVoice(actor, label, bytes, file.type);
  if (!result.ok) {
    if (result.status === 404) return c.json({ error: result.error }, 404);
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 201);
});

// Sets the signed-in person's OWN tts.voice_id, the same
// setPersonTtsVoiceUnchecked() escape hatch the catalog's own select
// route uses - `clonedVoiceExists()` is this route's equivalent of that
// route's live-catalog check, proving the id is real before it's ever
// written into a person's setting.
const clonedSelectRoute = createRoute({
  method: "post",
  path: "/cloned/:id/select",
  tags: ["Voice"],
  summary: "Select a cloned voice as the person's TTS voice",
  description:
    "Sets the signed-in person's own tts.voice_id to the given cloned voice. " +
    "The voice id must exist in the cloned-voice table.",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema } },
      description: "The updated person record.",
    },
    ...errorResponses({ 400: "Unknown settings key", 401: "Not signed in", 403: "Not allowed", 404: "Cloned voice not found" }),
  },
});

voiceRoutes.openapi(clonedSelectRoute, async (c) => {
  const actor = c.get("person");
  const id = c.req.valid("param").id;
  if (!clonedVoiceExists(id)) return c.json({ error: `cloned voice not found: ${id}` }, 404);
  const result = setPersonTtsVoiceUnchecked(actor, clonedVoiceUrl(id));
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 200);
});

// POST, not DELETE: no route anywhere in this app uses the DELETE verb
// (settings' own reset and memory's own archive are both POST too) -
// matching that rather than introducing the one exception.
const clonedDeleteRoute = createRoute({
  method: "post",
  path: "/cloned/:id/delete",
  tags: ["Voice"],
  summary: "Delete a cloned voice",
  description:
    "Deletes the given cloned voice from the household. Any signed-in person " +
    "can delete any cloned voice (same posture as the list and select routes).",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true) }),
        },
      },
      description: "Confirmation of deletion.",
    },
    ...errorResponses({ 401: "Not signed in", 403: "Only the creator or an owner/admin can delete", 404: "Cloned voice not found" }),
  },
});

voiceRoutes.openapi(clonedDeleteRoute, async (c) => {
  const actor = c.get("person");
  const id = c.req.valid("param").id;
  const result = deleteClonedVoice(actor, id);
  if (!result.ok) {
    if (result.status === 404) return c.json({ error: result.error }, 404);
    return c.json({ error: result.error }, 403);
  }
  return c.json({ success: true } as { success: true }, 200);
});

// Deliberately NOT behind requireAuth: `pocket-tts serve` is a separate,
// unauthenticated local process that fetches `voice_url` by plain HTTP
// GET (spec/voice/ts/client.ts) - it has no session cookie to send and
// never will. Safe because `id` is an unguessable 83-bit token
// (lib/id.ts's newClonedVoiceId()) checked against the real table, the
// same "unguessable, not merely hidden" posture session tokens use for
// the identical problem (an unauthenticated bearer of a capability).
const clonedFileRoute = createRoute({
  method: "get",
  path: "/cloned/:id/file",
  tags: ["Voice"],
  summary: "Download a cloned voice file",
  description:
    "Serves the raw audio file of a cloned voice. Deliberately NOT behind " +
    "requireAuth: the pocket-tts serve process fetches voice_url by plain " +
    "HTTP GET with no session cookie. Safe because the id is an unguessable " +
    "83-bit token.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "audio/wav": { schema: z.string().openapi({ format: "binary" }) } },
      description: "The raw cloned voice audio file.",
    },
    ...errorResponses({ 404: "Cloned voice not found" }),
  },
});

voiceRoutes.openapi(clonedFileRoute, async (c) => {
  const id = c.req.valid("param").id;
  const file = getClonedVoiceFile(id);
  if (!file) return c.json({ error: "not found" }, 404);
  return new Response(Bun.file(file.path), { status: 200, headers: { "content-type": file.mimeType } });
});
