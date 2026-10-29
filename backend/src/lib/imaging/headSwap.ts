import { cancelOrDelete, fetchPicture, getGenerationJob, submitEdit } from "@/lib/pictures/stack";

/** Plain-words instruction for putting one picture's face and head on the person in another. Any editor that holds two pictures of the same person can send it. */
export const headSwapInstruction = (): string => "Replace the face and head of the person in the first picture with the exact face and head of the person in the second picture: the same features, expression, skin marks, jewellery, hair and apparent age. Keep the first picture's body, clothes, pose and plain background unchanged. There is exactly one head.";

export interface HeadSwapRequest {
  /** The picture to fix (a body drawn around a head the model had to redraw). */
  drawn: Uint8Array;
  /** The real person's own picture, the source of the face. */
  face: Uint8Array;
  model: string;
  seed: number;
  /** Seconds to wait for the engine before giving up. */
  waitSeconds?: number;
}

/**
 * Puts the person's real face on a drawn body with the picture model's own reference editing (a second picture rides beside the first), the
 * way a face swapper would, but with the model the Stack already runs and no extra weights. Returns the swapped picture.
 */
export async function swapHead(request: HeadSwapRequest, pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<Uint8Array> {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(request.drawn)], "picture.png", { type: "image/png" }));
  form.append("reference", new File([new Uint8Array(request.face)], "face.png", { type: "image/png" }));
  form.append("reference_source", "uploaded");
  form.append("operation", "edit");
  form.append("instruction", headSwapInstruction());
  form.append("image_source", "uploaded");
  form.append("audience", "all-ages");
  form.append("timeout_ms", "1");
  form.append("model", request.model);
  form.append("seed", String(request.seed));
  const { job } = await submitEdit(form);
  const deadline = Date.now() + (request.waitSeconds ?? 240) * 1000;
  try {
    while (Date.now() < deadline) {
      const status = await getGenerationJob(job);
      if (status.state === "done") return await fetchPicture(job, 0);
      if (status.state === "failed" || status.state === "cancelled") throw new Error(status.error ?? "The face could not be placed on the picture. Try again.");
      await pause(800);
    }
    throw new Error("Placing the face took too long. Try again.");
  } finally { await cancelOrDelete(job); }
}
