// LIKENESS-01: what happens the moment a person takes their agreement back. It takes effect immediately: the next
// request is refused because consent is read from the person's own setting at request time; every picture or video of
// them still waiting or being made is stopped; and every saved style of them is queued for removal from the library
// (and removed now, or on the next pass if the engine does not answer). Imported by the app so the handler is always
// registered. What was already made and stored stays with the person who made it (the files are theirs); the settings
// page says so.
import { registerRevokeHandler, type LikenessOption } from "./history";
import { drainStyleRemovals, queueStyleRemoval } from "./adapters";
import { stopLikenessPictureJobs } from "@/lib/pictures/jobs";
import { stopLikenessVideoJobs } from "@/lib/videos/jobs";

export function revokeLikeness(personId: string, option: LikenessOption): void {
  if (option === "adults") {
    stopLikenessPictureJobs(personId, false);
    stopLikenessVideoJobs(personId, false);
    queueStyleRemoval(personId);
    void drainStyleRemovals();
  } else {
    stopLikenessPictureJobs(personId, true);
    stopLikenessVideoJobs(personId, true);
  }
}

registerRevokeHandler(revokeLikeness);
