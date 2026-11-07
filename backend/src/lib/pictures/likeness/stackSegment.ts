import { Buffer } from "node:buffer";
import { getStackClient } from "@/lib/stackEngine";

export interface SegmentPoint { x: number; y: number; label: 0 | 1 }
export interface SegmentPrompt { box?: [number, number, number, number]; points?: SegmentPoint[] }
export async function stackSegment(png: Uint8Array, prompt: SegmentPrompt): Promise<{ mask: Uint8Array; area: number }> {
  const form = new FormData();
  form.set("operation", "segment");
  form.set("prompt", JSON.stringify(prompt));
  form.set("image", new Blob([png], { type: "image/png" }), "picture.png");
  const reply = await getStackClient().imageEdit(form);
  const item = reply.kind === "done" ? reply.item : JSON.parse(Buffer.from(await getStackClient().imageEditResult(reply.job)).toString("utf8")) as { b64_json: string; area?: number };
  if (!item.b64_json) throw new Error("The Stack did not return a mask.");
  return { mask: new Uint8Array(Buffer.from(item.b64_json, "base64")), area: Number((item as { area?: number }).area ?? 0) };
}
