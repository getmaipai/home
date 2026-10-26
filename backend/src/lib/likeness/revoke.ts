// Subject disappearance invalidates jobs and saved style bindings. There is
// no per-person agreement or agreement-driven revocation state.
import { queueStyleRemoval, drainStyleRemovals } from "./adapters";
import { stopLikenessPictureJobs } from "@/lib/pictures/jobs";
import { stopLikenessVideoJobs } from "@/lib/videos/jobs";

export function likenessPersonGone(personId: string): void {
  stopLikenessPictureJobs(personId);
  stopLikenessVideoJobs(personId);
  queueStyleRemoval(personId);
  void drainStyleRemovals();
}
