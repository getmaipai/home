// MODEL-ADD-01 S4: adding a chat model from a pasted Hugging Face link. The
// Stack reads the repository (size, hash, licence, layer shape) without
// downloading it; this turns that reading into one ModelCapabilities record,
// stores it, and hands the download to the same switch every chat model uses.
import { addedModelId, recordFor, type InspectedModel } from "@/lib/addModelRecord";
import { saveAddedModel } from "@/lib/addedModels";
import { startChatModelChoice, type ChatSwitchState } from "@/lib/chatModelSwitch";
import { catalogEntries } from "@/lib/modelCatalog";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";

export class AddModelError extends Error {
  constructor(readonly status: 400 | 409 | 502, message: string) { super(message); this.name = "AddModelError"; }
}

function sentence(error: unknown): string {
  if (error instanceof StackError) {
    if (error.kind === "unknown" && error.body) {
      try { const parsed = JSON.parse(error.body) as { error?: unknown }; if (typeof parsed.error === "string" && parsed.error) return parsed.error; } catch { /* use the generic line */ }
    }
    if (error.kind === "unreachable" || error.kind === "timeout" || error.kind === "offline") return "The MaiPai Stack did not answer. Check that it is running, then try again.";
  }
  return "The model could not be read. Check the link, then try again.";
}

/** Asks the Stack to read the repository. Anything the record needs that the Stack could not read is a refusal, never a guess. */
export async function inspectForAdd(source: string, file?: string): Promise<InspectedModel> {
  if (!isStackConfigured()) throw new AddModelError(409, "The MaiPai Stack is not set up on this computer yet. Finish setup, then add a model.");
  const client = getStackClient();
  if (!client.inspectModel) throw new AddModelError(409, "The MaiPai Stack is too old to read a model link. Update the Stack, then try again.");
  let result: Record<string, any>;
  try { result = await client.inspectModel({ source, ...(file ? { file } : {}) }); } catch (error) {
    throw new AddModelError(error instanceof StackError && error.kind === "unknown" ? 400 : 502, sentence(error));
  }
  const missing = (what: string) => new AddModelError(400, `The repository does not state ${what}, so MaiPai cannot check or size this file. Pick another file.`);
  if (typeof result.sizeBytes !== "number" || result.sizeBytes <= 0) throw missing("the file size");
  if (typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.sha256)) throw missing("a checksum for the file");
  const architecture = result.architecture;
  if (!architecture || typeof architecture.name !== "string") throw missing("the model's architecture");
  if (!architecture.shape) throw missing("the model's layer shape");
  return {
    repo: String(result.repo), file: String(result.file), url: String(result.url), revision: String(result.revision), sizeBytes: result.sizeBytes, sha256: result.sha256,
    licence: typeof result.licence === "string" && result.licence ? result.licence : null,
    architecture: architecture.name, verifiedArchitecture: architecture.verified === true, shape: architecture.shape, ramBytes: Number(architecture.ramBytes) || 0,
  };
}

/** Reads the link, stores the record and starts the download (or the load, when the Stack already has the file). */
export async function addChatModel(source: string, file: string | undefined, addedBy: string): Promise<{ id: string; label: string; state: ChatSwitchState }> {
  const inspected = await inspectForAdd(source, file);
  const record = recordFor(inspected, addedBy);
  if (catalogEntries().some((model) => model.id === record.id && model.origin !== "added")) throw new AddModelError(409, "MaiPai already ships that model. Pick it from the list instead.");
  saveAddedModel(record, "added from a Hugging Face link by an admin");
  const started = await startChatModelChoice(record.id);
  if ("error" in started) throw new AddModelError(started.status === 502 ? 502 : 409, started.error);
  return { id: record.id, label: record.label, state: started };
}

export { addedModelId, recordFor, type InspectedModel };
