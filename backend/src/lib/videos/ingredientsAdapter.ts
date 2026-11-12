// The LTX 2.5 Ingredients adapter (a video LoRA of the Stack's library) that "make a video from pictures" (make_reference_video) needs. The Stack finds it by this exact
// NAME and answers 409 ic_lora_missing from POST /v1/videos/ingredients without it. This module is the one place that pins the file and reads its state, so the install
// wizard and Settings, AI and models (shared/aiChoices.ts, the "ingredients" card) list it with size, licence and readiness like every other model.
//
// Install goes through the Stack's existing LoRA install route (POST /stack/v1/video/loras/install: a Hugging Face file link, the person's Hugging Face token in that one
// body, the name below, all-ages, base ltx-2.5). The file is gated: its Hugging Face page asks the person to accept the LTX-2.x Community License there, and the household's
// licence acknowledgement (LICENCE-ACK-01) must cover that licence here. The adapter is an engine part, not a style: it is never offered in the Styles library (loras/sync.ts).
import { currentLicenceAck } from "@/lib/licenceAcceptance";
import { tokenFor } from "@/lib/loras/source";
import { getStackInstallJob, installStackLora, listVideoLoras, removeVideoLora, StackInstallRefused, StackVideoError } from "@/lib/videos/stack";

export const INGREDIENTS_NAME = "Video-from-pictures adapter";
/** The name the Stack's library holds it under: how the Stack's ingredients lane finds it. */
export const INGREDIENTS_LIBRARY_NAME = "ltx-2.5-22b-ic-lora-ingredients-0.9";
export const INGREDIENTS_FILE = "ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors";
export const INGREDIENTS_BYTES = 1_308_787_472;
export const INGREDIENTS_REPO = "Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients";
export const INGREDIENTS_URL = `https://huggingface.co/${INGREDIENTS_REPO}/resolve/main/${INGREDIENTS_FILE}`;
export const INGREDIENTS_PAGE = `https://huggingface.co/${INGREDIENTS_REPO}`;
export const INGREDIENTS_LICENCE = "LTX-2.x Community License";
export const INGREDIENTS_LICENCE_ID = "ltx-2.x-community-license";
export const INGREDIENTS_BASE = "ltx-2.5";

export const INGREDIENTS_NO_TOKEN_LINE = "Needs your Hugging Face token. Accept the terms on the adapter's Hugging Face page, then save your token in Settings, AI, Advanced, and press Install again.";
export const INGREDIENTS_NO_LICENCE_LINE = "Needs the maker's licence accepted first. Accept the licences in Settings, Models and storage (the one licence prompt), then press Install again.";
export const INGREDIENTS_AFTER_SETUP_LINE = "Add it after setup in Settings, AI and models: it needs your Hugging Face token and the maker's licence accepted first.";
export const INGREDIENTS_STACK_DOWN_LINE = "The AI engine is not answering, so Home cannot read or install the adapter. Check that the engine is running, then try again.";
export const INGREDIENTS_FAILED_LINE = "The adapter did not download. Check that this computer is online and the Hugging Face token is saved in Settings, AI, Advanced, then press Install again.";

export function ingredientsDescription(): string {
  return `Needed to make a video from pictures: it teaches the Max video model to use a reference sheet. 1.3 GB. Licence: ${INGREDIENTS_LICENCE}. Comes from huggingface.co (Lightricks). It asks you to accept its terms on Hugging Face and needs your Hugging Face token to download.`;
}

/** The household's licence acknowledgement covers the LTX licence (the Stack lists it under a dated id; the wizard's first-run record covers whatever the plan shows). */
export function ingredientsLicenceCovered(): boolean {
  const ack = currentLicenceAck();
  if (!ack) return false;
  return ack.licence_ids.some((id) => id === INGREDIENTS_LICENCE_ID || id.startsWith("ltx-2.x-community")) || (ack.by === "setup" && ack.licence_ids.length === 0);
}

export interface IngredientsState {
  /** The Stack answered. False leaves readiness unknown, never "installed". */
  reachable: boolean;
  installed: boolean; libraryId: string | null;
  installing: boolean; percent: number | null; failure: string | null;
  /** Why an install cannot start now, in words that say what to do; null when it can. */
  blockedReason: string | null;
}

let job: string | null = null;
let failure: string | null = null;

export function __resetIngredientsForTests(): void { job = null; failure = null; }

/** Reads the Stack's video LoRA library (GET /stack/v1/video/loras) for the adapter by its exact name, and follows a running install job. */
export async function ingredientsState(): Promise<IngredientsState> {
  let library;
  try { library = await listVideoLoras(); } catch {
    return { reachable: false, installed: false, libraryId: null, installing: false, percent: null, failure: null, blockedReason: INGREDIENTS_STACK_DOWN_LINE };
  }
  const found = library.find((lora) => lora.name === INGREDIENTS_LIBRARY_NAME) ?? null;
  if (found) { job = null; failure = null; return { reachable: true, installed: true, libraryId: found.id, installing: false, percent: null, failure: null, blockedReason: null }; }
  let percent: number | null = null;
  if (job) {
    try {
      const running = await getStackInstallJob(job);
      if (running === null) { job = null; failure = INGREDIENTS_FAILED_LINE; }
      else if (running.state === "failed" || running.state === "cancelled") { job = null; failure = INGREDIENTS_FAILED_LINE; }
      else if (running.state === "done") { job = null; }
      else percent = running.percent;
    } catch { /* the job read is progress only; the library listing above is the truth */ }
  }
  const blockedReason = !tokenFor("huggingface") ? INGREDIENTS_NO_TOKEN_LINE : !ingredientsLicenceCovered() ? INGREDIENTS_NO_LICENCE_LINE : null;
  return { reachable: true, installed: false, libraryId: null, installing: job !== null, percent, failure: job ? null : failure, blockedReason };
}

export type IngredientsInstall = { ok: true; job: string } | { ok: false; status: 409 | 503; error: string; code: string };

/** Starts the Stack's install job. Only an admin's action calls this; the licence acknowledgement and the token are checked here, not trusted from the caller. */
export async function installIngredients(addedBy: string): Promise<IngredientsInstall> {
  const state = await ingredientsState();
  if (!state.reachable) return { ok: false, status: 503, code: "stack_unreachable", error: INGREDIENTS_STACK_DOWN_LINE };
  if (state.installed) return { ok: false, status: 409, code: "already_installed", error: "The video-from-pictures adapter is already installed." };
  if (state.installing) return { ok: false, status: 409, code: "installing", error: "The adapter is still downloading." };
  const token = tokenFor("huggingface");
  if (!token) return { ok: false, status: 409, code: "no_token", error: INGREDIENTS_NO_TOKEN_LINE };
  if (!ingredientsLicenceCovered()) return { ok: false, status: 409, code: "licence_not_accepted", error: INGREDIENTS_NO_LICENCE_LINE };
  try {
    const started = await installStackLora("video", {
      source: "huggingface", url: INGREDIENTS_URL, name: INGREDIENTS_LIBRARY_NAME, licence: INGREDIENTS_LICENCE_ID, licence_acknowledged: true,
      audience: "all-ages", base_model: INGREDIENTS_BASE, added_by: addedBy, source_url: INGREDIENTS_PAGE, token,
    });
    job = started.job; failure = null;
    return { ok: true, job: started.job };
  } catch (error) {
    if (error instanceof StackInstallRefused) {
      const status = error.status === 503 ? 503 : 409;
      return { ok: false, status, code: error.code, error: error.message };
    }
    if (error instanceof StackVideoError) return { ok: false, status: 503, code: error.code, error: error.message };
    throw error;
  }
}

/** Removes the adapter from the Stack's library. A video from pictures says it is missing until an admin installs it again. */
export async function removeIngredients(): Promise<{ ok: true; removed: boolean } | { ok: false; status: 503; error: string }> {
  try {
    const found = (await listVideoLoras()).find((lora) => lora.name === INGREDIENTS_LIBRARY_NAME);
    if (!found) return { ok: true, removed: false };
    await removeVideoLora(found.id);
    return { ok: true, removed: true };
  } catch { return { ok: false, status: 503, error: INGREDIENTS_STACK_DOWN_LINE }; }
}
