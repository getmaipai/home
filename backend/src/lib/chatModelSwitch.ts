// MODEL-SWITCH-01: choosing the household's chat model from Settings,
// Models. Home holds no engine and no download of its own; it asks the
// Stack. A model the Stack has not installed is pulled (the weights and,
// when the model reads pictures, its projector) from the Stack's own pin,
// so there is one definition of the file, its revision and its hash. A
// model the Stack has installed is loaded: the Stack stores the choice, so
// it survives a restart. Progress of a download rides the existing job
// feed; the outcome of a load is read back from the chat role itself.
import { CATALOG } from "@/lib/modelCatalog";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { trackBackgroundWork } from "@/lib/backgroundWork";

export type ChatSwitchStatus = "none" | "downloading" | "loading" | "ready" | "failed";
export interface ChatSwitchState { modelId: string; status: ChatSwitchStatus; reason?: string; jobs?: string[] }

interface StackPin {
  id: string;
  role: string;
  repo?: string;
  license?: string;
  revision?: string;
  engine?: string;
  component?: string;
  imageInput?: { projector: string };
  download?: { url: string; sha256: string; approx_bytes: number };
}

const outcomes = new Map<string, { status: "loading" | "failed"; reason?: string }>();

export function __resetChatSwitchForTests(): void { outcomes.clear(); }

function pullBody(pin: StackPin) {
  if (!pin.download || !pin.license || !pin.revision) throw new Error(`The Stack has no complete pin for ${pin.id}.`);
  return {
    id: pin.id, role: pin.role, ...(pin.repo ? { repo: pin.repo } : {}), url: pin.download.url, sha256: pin.download.sha256,
    approx_bytes: pin.download.approx_bytes, licence: pin.license, revision: pin.revision,
    ...(pin.engine ? { engine: pin.engine } : {}), ...(pin.component ? { component: pin.component } : {}),
  };
}

/** The chat role as the Stack reports it: the model it runs, its state, and the ids it can start. */
async function chatRole(): Promise<{ modelId: string | null; state: string; installed: string[] } | null> {
  if (!isStackConfigured()) return null;
  const { roles } = await getStackClient().roles();
  const chat = roles.find((role) => role.id === "chat");
  if (!chat) return null;
  return { modelId: chat.model?.id ?? null, state: chat.state?.state ?? "offline", installed: (chat.models ?? []).map((model) => model.id) };
}

/** Starts the choice of one catalog chat model: loads it when the Stack has it, otherwise starts its downloads. */
export async function startChatModelChoice(modelId: string): Promise<ChatSwitchState | { error: string; status: 404 | 409 | 502 }> {
  const entry = CATALOG.find((model) => model.id === modelId && model.role === "chat" && model.implemented);
  if (!entry?.download) return { error: "That model is not in the list. Pick one of the models shown on this page.", status: 404 };
  let role: Awaited<ReturnType<typeof chatRole>>;
  try { role = await chatRole(); }
  catch { return { error: "The MaiPai Stack did not answer. Check that it is running, then try again.", status: 502 }; }
  if (!role) return { error: "The MaiPai Stack is not set up on this computer yet. Finish setup, then choose a model.", status: 409 };

  if (role.installed.includes(modelId)) {
    if (role.modelId === modelId && (role.state === "ready" || role.state === "loaded")) return { modelId, status: "ready" };
    outcomes.set(modelId, { status: "loading" });
    trackBackgroundWork(
      getStackClient().modelAction(modelId, "load").then((result) => {
        if (result.ok === false) outcomes.set(modelId, { status: "failed", reason: typeof result.reason === "string" ? result.reason : "The Stack could not start that model." });
        else outcomes.delete(modelId);
      }).catch((err: unknown) => {
        // The Stack keeps starting the model after Home stops waiting; the chat role itself says when it is up.
        if (err instanceof StackError && err.kind === "timeout") return;
        outcomes.set(modelId, { status: "failed", reason: err instanceof Error ? err.message : "The Stack could not start that model." });
      }),
    );
    return { modelId, status: "loading" };
  }

  try {
    const catalog = (await getStackClient().modelCatalog()) as { models?: StackPin[] };
    const pins = catalog.models ?? [];
    const pin = pins.find((candidate) => candidate.id === modelId && candidate.role === "chat");
    if (!pin) return { error: "The MaiPai Stack does not offer that model yet. Update the Stack, then try again.", status: 409 };
    const projector = pin.imageInput ? pins.find((candidate) => candidate.id === pin.imageInput!.projector) : undefined;
    if (pin.imageInput && !projector) return { error: "The MaiPai Stack lists that model without its picture file. Update the Stack, then try again.", status: 409 };
    const jobs: string[] = [];
    for (const part of [projector, pin]) {
      if (!part) continue;
      const started = await getStackClient().pullModel(pullBody(part));
      if (typeof started.job === "string") jobs.push(started.job);
    }
    return { modelId, status: "downloading", jobs };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The download could not start. Try again.", status: 502 };
  }
}

/** Where the choice of one model stands, from the chat role and the last load's outcome. */
export async function chatModelChoiceState(modelId: string): Promise<ChatSwitchState> {
  const failed = outcomes.get(modelId);
  if (failed?.status === "failed") return { modelId, status: "failed", ...(failed.reason ? { reason: failed.reason } : {}) };
  let role: Awaited<ReturnType<typeof chatRole>> = null;
  try { role = await chatRole(); } catch { /* the Stack not answering is "none", not a failure of this choice */ }
  if (role?.modelId === modelId && (role.state === "ready" || role.state === "loaded")) { outcomes.delete(modelId); return { modelId, status: "ready" }; }
  if (outcomes.get(modelId)?.status === "loading") return { modelId, status: "loading" };
  return { modelId, status: "none" };
}

/** The catalog's optional uncensored chat model, the one record tagged `uncensored`. */
export function uncensoredChatEntry() {
  return CATALOG.find((model) => model.role === "chat" && model.implemented && model.download && model.tags?.includes("uncensored"));
}

/** What the AI and models page needs to draw the uncensored choice: its sizes from the catalog, whether the Stack has it, whether it is the running chat model. Null when the catalog has none or the Stack does not answer. */
export async function uncensoredChoiceState(): Promise<{ id: string; installed: boolean; running: boolean; downloadBytes: number; installedBytes: number } | null> {
  const entry = uncensoredChatEntry();
  if (!entry?.download) return null;
  let role: Awaited<ReturnType<typeof chatRole>> = null;
  try { role = await chatRole(); } catch { return null; }
  if (!role) return null;
  const bytes = entry.download.approx_bytes + (entry.image_input?.projector.download.approx_bytes ?? 0);
  return {
    id: entry.id,
    installed: role.installed.includes(entry.id),
    running: role.modelId === entry.id,
    downloadBytes: bytes,
    installedBytes: bytes,
  };
}
