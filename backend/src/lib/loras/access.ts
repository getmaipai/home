// VIDEO-LORA-03 (docs/design/video-loras-2026-11-02.md section 7, docs/dev/loras.md): the SINGLE read path of the LoRA library. `loraAccess(person, lora,
// surface)` decides whether one record is `open`, `locked` (an adult-only LoRA, behind the Adult lock) or `hidden` for one person on one surface. Every route,
// the picker, the chat tool and the job start read records through `readLoras` / `readLora` here, so there is no per-route copy of the rule:
//
//   child, teen, guest, a spoken turn, a glance screen, a TV   hidden, adult-only or not (rule 8: a minor is not even told a LoRA exists)
//   owner or admin on their own written screen                  all-ages: open; adult-only: locked until their unlock proof is valid
//   other adult marked in `availability` (`adults` or `people`)  the same
//   other adult not marked                                       hidden
//   `generation.video.adult_adapters` is "restricted"            every adult-only video LoRA hidden for everyone, admins included
//
// A locked LoRA is one tile for the whole list (`lockedView`): no name, trigger words, add-ins, preview, hash, counts or ids.
import { speakerAgeBand } from "@/lib/ageBand";
import { isOwnerOrAdmin } from "@/lib/access";
import { lockState, lockedView, requestProof, type AdultProof } from "@/lib/adultLock";
import { adultVideoAdaptersAllowed } from "@/lib/videos/policy";
import { getLoraRecord, listLoraRecords, type Lora } from "@/lib/loras/store";
import type { PersonRow } from "@/types";

/** Where the person is: their own written screen, or somewhere shared or spoken (a glance screen, a TV, a robot, a speaker, a paired device). */
export type LoraSurface = "own_written" | "shared" | "spoken";
export type LoraAccess = "open" | "locked" | "hidden";

export function isAdult(person: PersonRow): boolean {
  return person.role !== "guest" && speakerAgeBand(person, new Date()) === "adult";
}

/** Whether this adult is one an admin marked able to use the LoRA (an owner or admin always is). */
export function availableTo(person: PersonRow, lora: Lora): boolean {
  if (isOwnerOrAdmin(person)) return true;
  const { who, people } = lora.availability;
  return who === "adults" || (who === "people" && people.includes(person.id));
}

export function loraAccess(person: PersonRow, lora: Lora, surface: LoraSurface = "own_written", proof: AdultProof = requestProof()): LoraAccess {
  if (!isAdult(person) || surface !== "own_written") return "hidden";
  const admin = isOwnerOrAdmin(person);
  if (!admin && (lora.removed_at !== null || !availableTo(person, lora))) return "hidden";
  if (lora.audience === "all-ages") return "open";
  if (lora.media === "video" && !adultVideoAdaptersAllowed()) return "hidden";
  // The Adult lock decides locked or open (and hidden for a minor, which the first line already returned).
  return lockState({ ownerPersonId: person.id, madeAudience: "adult-only", lock: "on" }, person, proof);
}

/** A LoRA a clip may be made with now: live, and its base known (an unknown base blocks use until an admin sets it). */
export function loraUsable(lora: Lora): boolean {
  return lora.removed_at === null && lora.base_model !== "unknown" && lora.compatible_with.length > 0;
}

export interface LoraList { items: Lora[]; /** One tile: some LoRAs are locked for this person. Never a count. */ locked: boolean }

/** The records this person may read now, and whether a locked tile stands for the rest. `removed: true` is the trash view (an admin's Recently removed). */
export function readLoras(person: PersonRow, surface: LoraSurface, opts: { media?: "video" | "picture"; removed?: boolean; proof?: AdultProof } = {}): LoraList {
  const items: Lora[] = [];
  let locked = false;
  if (opts.removed === true && !isOwnerOrAdmin(person)) return { items, locked };
  for (const lora of listLoraRecords()) {
    if ((opts.media ?? "video") !== lora.media) continue;
    if ((lora.removed_at !== null) !== (opts.removed === true)) continue;
    const access = loraAccess(person, lora, surface, opts.proof);
    if (access === "open") items.push(lora);
    else if (access === "locked") locked = true;
  }
  items.sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id));
  return { items, locked };
}

export type LoraRead = { state: "open"; lora: Lora } | { state: "locked" } | null;

/** One record by id for this person. A hidden record and a missing one answer the same (null), so an id cannot be probed for. */
export function readLora(person: PersonRow, id: string, surface: LoraSurface, proof?: AdultProof): LoraRead {
  const lora = getLoraRecord(id);
  if (!lora) return null;
  const access = loraAccess(person, lora, surface, proof);
  return access === "open" ? { state: "open", lora } : access === "locked" ? { state: "locked" } : null;
}

export { lockedView };
