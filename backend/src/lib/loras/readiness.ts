// STYLES-03: the synchronous LoRA base provider reads only status caches. Routes refresh the relevant media first.
import { installableBaseIds } from "./baseFamilies";
import { peekPictureEngineStatus } from "@/lib/pictures/ready";
import { peekVideoEngineStatus } from "@/lib/videos/ready";
import { ltx25LorasSupported } from "@/lib/videos/loraWire";
import { LTX25_MAX_MODEL, LTX25_MODEL } from "@/lib/videos/quality";

/** Installed bases whose engines currently report style support, or null when either engine status is unknown. */
export function installedBasesNow(): ReadonlySet<string> | null {
  const video = peekVideoEngineStatus();
  const picture = peekPictureEngineStatus();
  if (video === null && picture === null) return null;

  const bases = new Set<string>();
  if (video === null) for (const id of installableBaseIds("video")) bases.add(id);
  if (picture === null) for (const id of installableBaseIds("picture")) bases.add(id);
  if (video && (ltx25LorasSupported(video, LTX25_MODEL) || ltx25LorasSupported(video, LTX25_MAX_MODEL))) bases.add("ltx-2.5");

  if (picture) for (const model of picture.models) if (model.installed && model.loras === true) bases.add(model.id);
  // Keep the result aligned with the one table of installable base ids, including excluding Quick/Wan.
  const installable = new Set<string>([...installableBaseIds("video"), ...installableBaseIds("picture")]);
  return new Set([...bases].filter((id) => installable.has(id)));
}
