import { z } from "zod";
import { startEdit, loadSource, editToolsStatus, ImageEditError, LIBRARY_SOURCE } from "@/lib/imageEdit";
import { storeFile } from "@/lib/attachments";
import { startComment } from "@/lib/imageEdit";
import { runPictureTool } from "@/lib/pictures/people";
import { registerMediaOp } from "./registry";
import type { MediaOp } from "./types";
import { CLEARER_LEVELS } from "./clearerLevels";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listFragments } from "@/lib/media/templates";
import { composePicturePrompt, resolvePicks } from "@/lib/media/pictureFragments";
import { PICTURE_COVERAGE } from "./coverage";

const empty = z.object({});
const eraseArgs = z.object({ mask: z.instanceof(Uint8Array).optional(), people: z.string().optional(), subjects: z.string().optional() });
const upscaleArgs = z.object({ scale: z.union([z.literal(2), z.literal(4)]).default(2) });
const resizeArgs = z.object({ width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000) });
const cropArgs = z.object({ x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), width: z.number().min(0).max(1).optional(), height: z.number().min(0).max(1).optional(), aspect: z.enum(["1:1", "4:3", "3:2", "16:9", "9:16"]).optional(), rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe("Clockwise turn applied before the crop box (the Studio's Crop)."), flipHorizontal: z.boolean().optional(), flipVertical: z.boolean().optional() }).refine((v) => v.aspect ? v.x === undefined && v.y === undefined && v.width === undefined && v.height === undefined : (v.width !== undefined && v.height !== undefined) || Boolean(v.rotate || v.flipHorizontal || v.flipVertical), "Choose an aspect or a fractional crop rectangle.");
const adjustArgs = z.object({ brightness: z.number().min(-100).max(100).default(0), contrast: z.number().min(-100).max(100).default(0), saturation: z.number().min(-100).max(100).default(0), warmth: z.number().min(-100).max(100).default(0), auto: z.boolean().default(false) });
const blurArgs = z.object({ radius: z.number().min(1).max(40).default(12) });
const clearerArgs = z.object({
  level: z.enum(["quick", "better", "best"]).default("quick").describe("quick: sharper and less grainy, here and fast. better: AI enlarges and cleans it. best: AI restore (may be unavailable)."),
  size: z.enum(["1", "1.5", "2", "4"]).default("1").describe("Times bigger. quick: 1, 1.5 or 2. better: 2 or 4."),
});
const rotateArgs = z.object({ degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).describe("Clockwise quarter turns: 90, 180 or 270 degrees.") });
const flipArgs = z.object({ direction: z.enum(["horizontal", "vertical"]).describe("horizontal mirrors left to right; vertical turns it upside down.") });
const referenceSchema = z.object({ kind: z.literal("picture"), via: z.enum(["chat", "file"]), id: z.string(), conversationId: z.string().optional() });
const changeArgs = z.object({
  prompt: z.string().min(1),
  scope: z.enum(["clothes", "background", "face", "whole"]).optional().describe("What part may change: clothes, background, face, or whole picture."),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
  maskPng: z.instanceof(Uint8Array).nullable().optional(),
  referenceId: z.string().nullable().optional(),
  references: z.array(referenceSchema).optional(),
  styles: z.array(z.string()).max(2).optional(),
  subjects: z.array(z.string().max(80)).max(3).optional(),
});

/** Where a picture is read from: its chat, or the Library by file id (IMG-OPS-02). The gates for either run in lib/imageEdit.ts's loadSource. */
function chatSource(source: { via?: "chat" | "file"; conversationId?: string; id: string }) {
  if (source.via === "file") return { conversationId: LIBRARY_SOURCE, id: source.id };
  if (!source.conversationId) throw new Error("A chat picture needs its conversation id.");
  return { conversationId: source.conversationId, id: source.id };
}

function registerEdit(id: string, label: string, summary: string, args: any, controls: any[], operation: "remove_background" | "depth" | "erase" | "upscale" | "resize" | "crop" | "adjust" | "blur_background" | "rotate" | "flip" | "clearer", levels?: MediaOp["levels"], extra: { listed?: false; values?: (values: any) => any } = {}) {
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
    ...(levels ? { levels } : {}),
    ...(extra.listed === false ? { listed: false } : {}),
    run: async ({ actor, signal }, { source, args: values }: any) => {
      const given = extra.values ? extra.values(values) : values;
      const result = await startEdit(actor, chatSource(source).conversationId, source.id, { operation, ...given, ...(given.size !== undefined ? { size: Number(given.size) } : {}) }, signal);
      return "job" in result ? { job: result } : { file: result };
    },
  });
}

registerEdit("remove_background", "Remove background", "Make the background transparent.", empty, [], "remove_background");
registerEdit("depth", "Depth map", "Make a grayscale picture of how near or far things are.", empty, [], "depth");
registerEdit("erase", "Erase", "Remove a painted area or selected people from the picture.", eraseArgs, [{ kind: "mask", name: "mask", label: "Area to erase" }], "erase");
// MAKE-CLEARER-2026-11-13: there is one tool. The old `upscale` is not listed any more (no Studio entry); an old caller (the editor's Resize bar, chat, the image-edit route) still runs it, as Make clearer at the Better level.
registerEdit("upscale", "Upscale", "Make the picture larger (the Better level of Make clearer).", upscaleArgs, [{ kind: "choice", name: "scale", label: "Scale", options: ["2", "4"] }], "clearer", undefined, { listed: false, values: (values: { scale: 2 | 4 }) => ({ level: "better", size: String(values.scale) }) });
registerEdit("resize", "Resize", "Set a new picture width and height.", resizeArgs, [{ kind: "number", name: "width", label: "Width", min: 1, max: 8000 }, { kind: "number", name: "height", label: "Height", min: 1, max: 8000 }], "resize");
registerEdit("crop", "Crop", "Crop a picture by fractional bounds or a centred aspect ratio.", cropArgs, [{ kind: "number", name: "x", label: "Left", min: 0, max: 1 }, { kind: "number", name: "y", label: "Top", min: 0, max: 1 }, { kind: "number", name: "width", label: "Width", min: 0, max: 1 }, { kind: "number", name: "height", label: "Height", min: 0, max: 1 }, { kind: "choice", name: "aspect", label: "Aspect", options: ["1:1", "4:3", "3:2", "16:9", "9:16"] }], "crop");
registerEdit("adjust", "Adjust", "Adjust brightness, contrast, saturation and warmth, or apply auto tone.", adjustArgs, [{ kind: "number", name: "brightness", label: "Brightness", min: -100, max: 100 }, { kind: "number", name: "contrast", label: "Contrast", min: -100, max: 100 }, { kind: "number", name: "saturation", label: "Saturation", min: -100, max: 100 }, { kind: "number", name: "warmth", label: "Warmth", min: -100, max: 100 }, { kind: "choice", name: "auto", label: "Auto tone", options: ["true", "false"] }], "adjust");
registerEdit("rotate", "Rotate", "Turn the picture a quarter or half turn.", rotateArgs, [{ kind: "choice", name: "degrees", label: "Turn", options: ["90", "180", "270"] }], "rotate");
registerEdit("flip", "Flip", "Mirror the picture left to right, or turn it upside down.", flipArgs, [{ kind: "choice", name: "direction", label: "Direction", options: ["horizontal", "vertical"] }], "flip");
registerEdit("blur_background", "Blur background", "Blur the picture background while keeping the subject clear.", blurArgs, [{ kind: "number", name: "radius", label: "Blur", min: 1, max: 40 }], "blur_background");
registerEdit("make_clearer", "Make clearer", "Make the picture clearer, and bigger if you like. Quick is fast, Better and Best use AI.", clearerArgs, [{ kind: "choice", name: "level", label: "Level", options: ["quick", "better", "best"] }, { kind: "choice", name: "size", label: "Size", options: ["1", "1.5", "2"] }], "clearer", CLEARER_LEVELS);

registerMediaOp({
  id: "picture.save_subject",
  label: "Save subject",
  summary: "Save this picture as a named character, prop, or place for later pictures.",
  input: "picture",
  output: "data",
  args: z.object({ name: z.string().min(1).max(80), kind: z.enum(["character", "prop", "place"]), look: z.string().min(1).max(1000) }),
  controls: [{ kind: "words", name: "name", label: "Subject name" }, { kind: "words", name: "look", label: "Look words" }],
  needs: null,
  minBand: "child",
  listed: false,
  run: async ({ actor }, { source, args }: any) => {
    const loaded = loadSource(actor, chatSource(source).conversationId, source.id, false);
    const sourceIsGenerated = /^picture-gen:/.test(db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, source.id)).get()?.provenance ?? "");
    if (actor.role === "child" || actor.role === "teen") {
      if (!sourceIsGenerated) throw new ImageEditError(422, "I can't save a real photo as a subject for this profile yet.", "real_minor_subject");
      const screen = await screenInputImage(loaded.bytes, args.look, viewerOf(actor));
      if (!screen.ok) throw new ImageEditError(422, screen.line, screen.code);
    }
    const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: loaded.mediaType, bytes: loaded.bytes, provenance: "media-subject-reference", retention: "kept", name: `${args.name} reference`, deduplicate: false });
    if (!saved.ok) throw new ImageEditError(saved.status, saved.error, "save_failed");
    const subject = createMediaSubject(actor, { name: args.name, kind: args.kind, look: args.look, referenceIds: [saved.value.id], real: false }, "chat");
    return { subject: { id: subject.id, name: subject.name, kind: subject.kind } };
  },
});

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
    const values = args as z.infer<typeof changeArgs>;
    const { subjectsForNames } = await import("@/lib/mediaSubjects");
    const selected = subjectsForNames(actor, values.subjects ?? []);
    if (!selected) throw new ImageEditError(422, "Choose a saved subject from your available list.", "unknown_subject");
    const result = await startComment(actor, chatSource(source).conversationId, source.id, {
      ...values,
      prompt: [...selected.map(({ subject }) => subject.look), values.prompt].join(". "),
      subjectIds: selected.map(({ subject }) => subject.id),
    });
    return "job" in result ? { job: result } : { file: result };
  },
});

const angleArgs = z.object({ angle: z.string().min(1) });
const coverageArgs = z.object({ coverage: z.enum(["wide", "medium", "close"]) });

/** Word edits share picture.change's model route and therefore all of its image, age and lock gates. */
async function startWordsEdit(actor: import("@/types").PersonRow, source: { via?: "chat" | "file"; conversationId?: string; id: string }, prompt: string) {
  const result = await startComment(actor, chatSource(source).conversationId, source.id, { prompt });
  return "job" in result ? { job: result } : { file: result };
}

registerMediaOp({
  id: "picture.angle",
  label: "Change the angle",
  summary: "Re-render this picture from a selected camera angle, keeping its subject, pose and framing rules.",
  input: "picture",
  output: "picture",
  args: angleArgs,
  controls: [{ kind: "choice", name: "angle", label: "Angle", options: [] }],
  needs: "image",
  minBand: "child",
  run: async ({ actor }, { source, args }: { source: import("@/lib/mediaOps/types").MediaRef; args: z.infer<typeof angleArgs> }) => {
    const row = listFragments({ actor, group: "angle" }).find((fragment) => fragment.id === args.angle || fragment.title === args.angle);
    if (!row) throw new ImageEditError(422, "Choose an available picture angle.", "unknown_angle");
    if (!resolvePicks({ angle: row.id }, actor)) throw new ImageEditError(422, "Choose an available picture angle.", "unknown_angle");
    return startWordsEdit(actor, source, composePicturePrompt("", { angle: row.id }, { edit: true }, actor).prompt);
  },
});

registerMediaOp({
  id: "picture.coverage",
  label: "Another shot size",
  summary: "Re-render this picture at a different shot size while keeping the same subject and scene.",
  input: "picture",
  output: "picture",
  args: coverageArgs,
  controls: [{ kind: "choice", name: "coverage", label: "Shot size", options: ["wide", "medium", "close"] }],
  needs: "image",
  minBand: "child",
  run: async ({ actor }, { source, args }: { source: import("@/lib/mediaOps/types").MediaRef; args: z.infer<typeof coverageArgs> }) => startWordsEdit(actor, source, PICTURE_COVERAGE[args.coverage]),
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

function sourceData(source: { id: string; via?: "chat" | "file"; conversationId?: string }, actor: import("@/types").PersonRow): { bytes: Uint8Array; mediaType: string } {
  const loaded = loadSource(actor, chatSource(source).conversationId, source.id, false);
  return { bytes: loaded.bytes, mediaType: loaded.mediaType };
}
