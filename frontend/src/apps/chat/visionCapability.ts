/** No cloud vision path exists in Home. This is deliberately separate from
 * chat health: a running text engine is not evidence that it accepts image
 * parts. */
export interface LocalVisionCapability {
  imageParts: boolean;
  engine: "text-only" | "vision";
  transport: "local";
}

export const CURRENT_LOCAL_VISION_CAPABILITY: LocalVisionCapability = {
  imageParts: false,
  engine: "text-only",
  transport: "local",
};

export const IMAGE_VISION_UNAVAILABLE_MESSAGE =
  "I can keep that image on this device, but MaiPai's selected local engine cannot interpret images yet.";

/** A model is image-capable only when the selected role explicitly declares
 * a real, implemented local vision engine. A chat model, even when healthy,
 * must never receive an image part by assumption. */
export function localVisionCapabilityForEngine(engine: { role: string; implemented: boolean } | null | undefined): LocalVisionCapability {
  if (engine?.role === "vision" && engine.implemented) {
    return { imageParts: true, engine: "vision", transport: "local" };
  }
  return CURRENT_LOCAL_VISION_CAPABILITY;
}
