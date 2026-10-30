import { useContext, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { EngineHealthEntry, Roster } from "@/lib/api";
import { chatAvailability, type ChatAvailability } from "@/apps/chat/chatAvailability";
import { useHealthQuery } from "@/apps/chat/useChatAvailability";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

export type MakingKind = "image" | "video";

export interface MakingAvailability {
  availability: ChatAvailability;
  /** The one line a disabled control shows, picked for this person's band from the health row's `notice` (the words live in
   * backend failureCopy.ts's makingNotice, never here). Null while ready. */
  reason: string | null;
  disabled: boolean;
}

/** The person-facing reading of one making row. A row that never arrived (an older hub) reads as ready, as chat's does, so a
 * control is never disabled on a guess; the Stack's own refusal still answers in plain words. */
export function makingAvailability(entry: EngineHealthEntry | undefined, person: Pick<Roster, "age_band"> | null): MakingAvailability {
  const availability = chatAvailability(entry);
  if (availability === "ready") return { availability, reason: null, disabled: false };
  const notice = entry?.notice;
  const band = person?.age_band ?? "child";
  const reason = notice ? (band === "adult" ? notice.adult : band === "teen" ? notice.teen : notice.child) : null;
  return { availability, reason, disabled: true };
}

/** ENGINE-STATUS-MEDIA-01 (RULES.md S6, "Pictures and video are not ready"): whether a picture ("image") or a clip ("video") can be
 * started now. It reads the same ["health"] query the chat composer reads, so it adds no request and no polling loop. A control that
 * starts a picture or a clip passes `disabled` to the kit control and shows `reason` in that screen's existing muted line. */
export function useMakingAvailability(kind: MakingKind): MakingAvailability {
  const person = useContext(WakeWordPersonContext);
  const entry = useHealthQuery().data?.engines?.[kind];
  return makingAvailability(entry, person);
}

/** What the one recovery toast says, per kind of work that was waiting. No figures, ever. */
export const MAKING_BACK_LINE = {
  picture: "Picture making is back, your picture is going.",
  animation: "Picture making is back, your animation is going.",
} as const;

/** ENGINE-STATUS-MEDIA-01, owner's ruling 2026-10-29 (the "Interrupt" rung of the prominence ladder): when making comes back and
 * this screen still has a request waiting (a queued picture, a clip run), one dismissable kit toast says so, once. With nothing
 * waiting the controls simply turn normal again. The toast belongs to the screen: a person who left it gets none. */
const showRecoveryToast = (line: string) => { toast(line, { id: `making-back:${line}`, dismissible: true }); };
export function useMakingRecovery(making: MakingAvailability, waiting: boolean, line: string, notify: (line: string) => void = showRecoveryToast): void {
  const wasDown = useRef(false);
  useEffect(() => {
    if (making.disabled) { wasDown.current = true; return; }
    if (!wasDown.current) return;
    wasDown.current = false;
    if (waiting) notify(line);
  }, [making.disabled, waiting, line, notify]);
}
