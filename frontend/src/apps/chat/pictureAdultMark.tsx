// ADULT-LOCK-07: the picture card's mark controls follow the video card's confirm and ticket flow.
import { useContext, useState, type ReactNode } from "react";
import { AdultLockDialog, type UnlockResult } from "@maipai/ui/src/elements/adult-lock";
import { ApiError } from "@/lib/api";
import { adultCredential } from "@/lib/adultLock";
import { picturesApi, type PictureCard } from "@/lib/picturesApi";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { GalleryAction } from "@maipai/ui/src/elements/image-gallery";
import { unmarkExplainer } from "@/apps/chat/videoAdultMark";

export function usePictureAdultMark(card: Pick<PictureCard, "id" | "adult">, refresh: () => void): { actions: GalleryAction[]; dialog: ReactNode; stateLine: string | null } {
  const me = useContext(WakeWordPersonContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const adult = card.adult;
  const credential = adultCredential(me);
  if (!adult) return { actions: [], dialog: null, stateLine: null };
  const check = async (passcode: string): Promise<UnlockResult> => {
    try {
      const { ticket } = await picturesApi.confirmUnmark(card.id, passcode);
      await picturesApi.adultMark(card.id, { action: "clear", ticket });
      return { status: "ok" };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return { status: "failed" };
      if (error instanceof ApiError && error.status === 429) return { status: "locked_out", retryAfterSeconds: error.retryAfter ?? 60 };
      throw error;
    }
  };
  const markAgain = () => {
    if (busy) return;
    setBusy(true); setProblem(null);
    void picturesApi.adultMark(card.id, { action: "mark" }).catch((error: unknown) => setProblem(error instanceof ApiError ? error.message : "Could not mark it. Check your connection and try again.")).finally(() => { setBusy(false); refresh(); });
  };
  const actions: GalleryAction[] = [];
  if (adult.can_clear) actions.push({ id: "adult-unmark", label: "Unmark as NSFW", hint: adult.line ?? undefined, disabled: busy, onSelect: () => setOpen(true) });
  if (adult.can_mark) actions.push({ id: "adult-mark", label: "Mark as NSFW", hint: adult.line ?? undefined, disabled: busy, onSelect: markAgain });
  const dialog = adult.can_clear ? <AdultLockDialog key="adult-unmark-dialog" open={open} onOpenChange={setOpen} unlock={check} onUnlocked={() => { setOpen(false); refresh(); }} {...credential} hasCredential={me?.hasSecret !== false} title="Remove the adult lock?" description={unmarkExplainer(credential.credentialKind)} actionLabel="Remove lock" /> : null;
  return { actions, dialog, stateLine: problem ?? adult.line };
}
