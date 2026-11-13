// The words box: the model picks one registered picture operation for a person's sentence (one forced edit_picture call) and Home runs it through the
// registry. Written once for both ways in: a picture in a chat (POST /api/image-edit/pictures/{id}/words) and a Library picture (POST /api/media-ops/words).
// The painted area and the second pictures the person gave are put on the chosen operation when it takes them (picture.change reads `maskPng` and
// `references`, erase reads `mask`), so nothing the person drew or picked is dropped on the way.
import { ImageEditError } from "@/lib/imageEdit";
import { complete } from "@/lib/llm";
import { listMediaOps, runMediaOp } from "@/lib/mediaOps/registry";
import { withAttachments } from "@/lib/mediaOps/http";
import type { MediaRef } from "@/lib/mediaOps/types";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import type { TurnState } from "@/lib/turnMachine/contract";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import type { PersonRow } from "@/types";

export interface WordsRequest { source: MediaRef; prompt: string; mask?: string | null; references?: string[] }

export async function runPictureWords(actor: PersonRow, request: WordsRequest, signal?: AbortSignal) {
  const operations = (await listMediaOps(actor, { input: "picture", includeHelpers: true })).filter((operation) => operation.enabled);
  const sourceId = request.source.id;
  const tool = toolSpecFor("edit_picture", laneOfPerson(actor), { actor, editPictureAllowed: operations.length > 0, editPictureOps: operations, editPictureIds: [sourceId] } as TurnState);
  if (!tool || !operations.some((operation) => operation.enabled)) throw new ImageEditError(503, "Picture edits are not available yet.", "unavailable");
  const forced = await complete("chat", [{ role: "user", content: `Picture id: ${sourceId}. Painted area supplied: ${request.mask ? "yes" : "no"}. Other picture ids: ${(request.references ?? []).join(", ")}. Request: ${request.prompt}` }], { tools: [tool], tool_choice: "required", thinking: false, dropReasoning: true, signal });
  if (!forced.ok) throw new ImageEditError(503, "The picture edit could not be chosen right now.", "model_unavailable");
  const call = forced.value.tool_calls?.find((item) => item.tool === "edit_picture");
  if (!call || !call.args || typeof call.args !== "object") throw new ImageEditError(503, "The picture edit could not be chosen right now.", "no_tool_call");
  const selected = call.args as { op?: unknown; args?: Record<string, unknown> };
  const operation = operations.find((item) => item.id === selected.op && item.enabled);
  if (!operation) throw new ImageEditError(422, "That picture operation is not available.", "operation_unavailable");
  const chat = request.source.via === "chat" ? { conversationId: request.source.conversationId } : undefined;
  const taken = new Set(Object.keys((operation.args as unknown as { shape?: Record<string, unknown> }).shape ?? {}));
  const usesMask = operation.controls.some((control) => control.kind === "mask") || taken.has("maskPng");
  const extra = withAttachments(operation, { args: selected.args, mask: usesMask ? request.mask : undefined, references: taken.has("references") ? request.references : undefined }, chat);
  return runMediaOp(actor, operation.id, { source: request.source, args: extra }, signal);
}
