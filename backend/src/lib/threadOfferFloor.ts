// NAT-07c: the deterministic floor under "pick up where we left off" (docs/design/warmth-over-time-2026-10-28.md
// section 2.3). It decides only whether a record may EVER be offered as an opening thread; it never adds a record,
// and it only withholds. Rule 6a: the answer carries a reason id, never the record's text.
import { hasAdultToTellCue } from "@/lib/childDisclosure";

/** The kinds a thread can be; a mood is a `state` and is handled by the care move, not here. */
const THREAD_KINDS: ReadonlySet<string> = new Set(["event", "goal", "project"]);

export type ThreadWithheldReason = "kind" | "adult_to_tell" | "sensitive" | "offer_withheld";
export type ThreadFloor = { offerable: true } | { offerable: false; reason: ThreadWithheldReason };

export interface ThreadFloorInput {
  category: string;
  text: string;
  /** The person set it sensitive. */
  sensitive: boolean;
  /** The judge's one withholding tag at extraction; it can only add withholding. Absent on records written before it existed. */
  offerWithheld?: boolean | null;
}

export function threadOfferFloor(record: ThreadFloorInput): ThreadFloor {
  if (!THREAD_KINDS.has(record.category)) return { offerable: false, reason: "kind" };
  if (record.sensitive) return { offerable: false, reason: "sensitive" };
  if (record.offerWithheld === true) return { offerable: false, reason: "offer_withheld" };
  if (hasAdultToTellCue(record.text)) return { offerable: false, reason: "adult_to_tell" };
  return { offerable: true };
}
