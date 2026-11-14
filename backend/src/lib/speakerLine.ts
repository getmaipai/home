import type { SpeakerEvidence, Surface } from "@/lib/turnShared";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";

const SHARED_SURFACES: readonly Surface[] = ["tv", "overlay", "pod"];

/** Facts the scene may state about the current speaker. Names come only from
 * the roster and only from evidence that is confirmed or signed in. */
export function speakerLine(
  evidence: SpeakerEvidence | null | undefined,
  surface: Surface,
  actor: PersonRow,
  roster: readonly PersonRow[],
  greetByName: unknown = true,
  othersPresent = 0,
): string {
  const other = othersPresent > 0 ? ` Others present: ${othersPresent} unknown.` : "";
  if (!evidence || evidence.basis === "unknown" || evidence.level === "unknown" || !evidence.person) {
    return `Speaker: unknown${SHARED_SURFACES.includes(surface) ? " on a shared screen" : ""}.${other}`;
  }
  if (evidence.basis === "claimed") {
    const claimed = roster.find((person) => person.id === evidence.person)?.displayName ?? "that name";
    return `Speaker: claims to be ${claimed}, not verified.${other}`;
  }
  const namedLevel = evidence.basis === "signed_in" || evidence.level === "confirmed";
  if (!namedLevel) {
    const name = roster.find((person) => person.id === evidence.person)?.displayName;
    if (!name) return `Speaker: unknown.${other}`;
    const qualifier = evidence.basis === "face" ? "seen, not yet heard clearly" : "voice, not sure";
    return `Speaker: probably ${name} (${qualifier}).${other}`;
  }
  const person = roster.find((member) => member.id === evidence.person);
  if (!person) return `Speaker: unknown.${other}`;
  if (evidence.basis !== "signed_in" && greetByName !== true) {
    const band = speakerAgeBand(person, new Date());
    return `Speaker: a household ${band}, confirmed by ${evidence.basis === "voice_and_face" ? "face and voice" : evidence.basis}; name not to be spoken.${other}`;
  }
  if (evidence.basis === "signed_in") return `Speaker: ${person.displayName} (signed in).${other}`;
  const how = evidence.basis === "voice_and_face" ? "face and voice" : evidence.basis;
  return `Speaker: ${person.displayName}, confirmed by ${how}.${other}`;
}
