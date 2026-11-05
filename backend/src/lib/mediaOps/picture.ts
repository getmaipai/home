import { z } from "zod";
import { startEdit, loadSource, editToolsStatus, ImageEditError } from "@/lib/imageEdit";
import { startComment } from "@/lib/imageEdit";
import { runPictureTool } from "@/lib/pictures/people";
import { registerMediaOp } from "./registry";

const empty = z.object({});
const eraseArgs = z.object({ mask: z.instanceof(Uint8Array).optional(), people: z.string().optional(), subjects: z.string().optional() });
const upscaleArgs = z.object({ scale: z.union([z.literal(2), z.literal(4)]).default(2) });
const resizeArgs = z.object({ width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000) });
const referenceSchema = z.object({ kind: z.literal("picture"), via: z.literal("chat"), id: z.string(), conversationId: z.string().optional() });
const changeArgs = z.object({
  prompt: z.string().min(1),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
  maskPng: z.instanceof(Uint8Array).nullable().optional(),
  referenceId: z.string().nullable().optional(),
  references: z.array(referenceSchema).optional(),
  styles: z.array(z.string()).max(2).optional(),
});

function chatSource(source: { conversationId?: string; id: string }) {
  if (!source.conversationId) throw new Error("A chat picture needs its conversation id.");
  return { conversationId: source.conversationId, id: source.id };
}

function registerEdit(id: string, label: string, summary: string, args: any, controls: any[], operation: "remove_background" | "erase" | "upscale" | "resize") {
  registerMediaOp({
    id: `picture.${id}`,
    label,
    summary,
    input: "picture",
    output: "picture",
    args,
    controls,
    needs: null,
    minBand: "child",
    run: async ({ actor, signal }, { source, args: values }: any) => {
      const result = await startEdit(actor, chatSource(source).conversationId, source.id, { operation, ...values }, signal);
      return "job" in result ? { job: result } : { file: result };
    },
  });
}

registerEdit("remove_background", "Remove background", "Make the background transparent.", empty, [], "remove_background");
registerEdit("erase", "Erase", "Remove a painted area or selected people from the picture.", eraseArgs, [{ kind: "mask", name: "mask", label: "Area to erase" }], "erase");
registerEdit("upscale", "Upscale", "Make the picture larger.", upscaleArgs, [{ kind: "choice", name: "scale", label: "Scale", options: ["2", "4"] }], "upscale");
registerEdit("resize", "Resize", "Set a new picture width and height.", resizeArgs, [{ kind: "number", name: "width", label: "Width", min: 1, max: 8000 }, { kind: "number", name: "height", label: "Height", min: 1, max: 8000 }], "resize");

registerMediaOp({
  id: "picture.change",
  label: "Change",
  summary: "Change a picture using words and reference pictures.",
  input: "picture",
  output: "picture",
  args: changeArgs,
  controls: [{ kind: "words", name: "prompt", label: "Describe the change" }],
  needs: "image",
  minBand: "child",
  run: async ({ actor }, { source, args }) => {
    const result = await startComment(actor, chatSource(source).conversationId, source.id, args as z.infer<typeof changeArgs>);
    return "job" in result ? { job: result } : { file: result };
  },
});

registerMediaOp({
  id: "picture.locate",
  label: "Locate subjects",
  summary: "Find picture subjects and return their numbered boxes and labels.",
  input: "picture",
  output: "data",
  args: empty,
  controls: [],
  needs: null,
  minBand: "child",
  listed: false,
  run: async ({ actor, signal }, { source }) => {
    const status = await editToolsStatus(actor);
    const key = status.tools.find_subjects ? "find_subjects" : "find_people";
    if (!status.tools[key].enabled) {
      throw new ImageEditError(503, status.tools[key].reason ?? status.note ?? "The picture finder isn't available yet.", "unavailable");
    }
    const picture = sourceData(source, actor);
    const found = await runPictureTool(key, picture.bytes, picture.mediaType, {}, signal);
    const subjects = found.subjects?.map((box) => ({ n: box.id, x: box.x, y: box.y, width: box.w, height: box.h, kind: box.kind, ...(box.label ? { label: box.label } : {}) }))
      ?? found.people?.map((box) => ({ n: box.id, x: box.x, y: box.y, width: box.w, height: box.h, kind: "person" })) ?? [];
    const people = subjects.filter((box) => box.kind === "person");
    console.info("media_op.subjects_found", { count: subjects.length });
    return { subjects, people };
  },
});

function sourceData(source: { id: string; conversationId?: string }, actor: import("@/types").PersonRow): { bytes: Uint8Array; mediaType: string } {
  if (!source.conversationId) throw new Error("A chat picture needs its conversation id.");
  const loaded = loadSource(actor, source.conversationId, source.id, false);
  return { bytes: loaded.bytes, mediaType: loaded.mediaType };
}
