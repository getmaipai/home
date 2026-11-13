import sharp from "sharp";
import { completeViaStackRequest, type LlmMessage } from "@/lib/llm";
import { pictureReader, downscaleForCheck, type PictureReader } from "./ageCheck";

export type Pose = "standing" | "seated" | "cropped";
export interface SeatBox { x: number; y: number; w: number; h: number }
const POSE_SCHEMA = { name: "person_pose", strict: true, schema: { type: "object", additionalProperties: false, required: ["pose"], properties: { pose: { type: "string", enum: ["standing", "seated", "cropped"] } } } } as const;
const SEAT_SCHEMA = { name: "seat_box", strict: true, schema: { type: "object", additionalProperties: false, required: ["box"], properties: { box: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["x", "y", "w", "h"], properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, w: { type: "number", minimum: 0, maximum: 1 }, h: { type: "number", minimum: 0, maximum: 1 } } }] } } } } as const;
let visionForTests: ((dataUrl: string, task: "pose" | "seat") => Promise<string>) | null = null;
export function __setPoseVisionForTests(fn: typeof visionForTests): void { visionForTests = fn; }
function object(text: string): Record<string, unknown> | null { try { const a = text.indexOf("{"), b = text.lastIndexOf("}"); return JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text) as Record<string, unknown>; } catch { return null; } }
export function parsePose(text: string): Pose | null { const value = object(text)?.pose; return value === "standing" || value === "seated" || value === "cropped" ? value : null; }
export function parseSeatBox(text: string): SeatBox | null { const box = object(text)?.box; if (!box || typeof box !== "object") return null; const b = box as Record<string, unknown>; if (![b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) || (b.x as number) + (b.w as number) > 1 || (b.y as number) + (b.h as number) > 1) return null; return b as unknown as SeatBox; }
async function ask(bytes: Uint8Array, task: "pose" | "seat"): Promise<string> {
  if (visionForTests) return visionForTests(`data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`, task);
  const reader: PictureReader | null = await pictureReader(); if (!reader) throw new Error("vision unavailable");
  const jpeg = await downscaleForCheck(bytes); const url = `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  const schema = task === "pose" ? POSE_SCHEMA : SEAT_SCHEMA;
  const messages: LlmMessage[] = [{ role: "system", content: task === "pose" ? "Classify the person's visible pose as standing, seated, or cropped. Reply only with JSON {pose}." : "Find a visible seat where a person could sit. Return normalized x,y,w,h fractions for the seat area or null. Reply only with JSON {box}." }, { role: "user", content: task === "pose" ? "What is the person's pose?" : "Where is a seat for a person?", images: [{ id: "image", name: "image", url, reservedTokens: 2560 }] }];
  const result = await completeViaStackRequest(reader, { model: reader, messages, stream: false, temperature: 0, max_tokens: 100, response_format: { type: "json_schema", json_schema: schema }, chat_template_kwargs: { enable_thinking: false } }, new AbortController().signal);
  if (!result.ok) throw new Error(result.failure.error); const content = (result.data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content; if (typeof content !== "string") throw new Error("no answer"); return content;
}
export async function readPose(image: Uint8Array): Promise<{ pose: Pose }> { try { return { pose: parsePose(await ask(image, "pose")) ?? "standing" }; } catch { return { pose: "standing" }; } }
export async function readSeatBox(plate: Uint8Array): Promise<SeatBox | null> { try { return parseSeatBox(await ask(plate, "seat")); } catch { return null; } }
