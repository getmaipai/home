// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10): the item's "Unmark as NSFW" and "Mark as NSFW" actions for a clip's creator, and the confirm
// dialog before the lock is removed. The dialog is the kit's AdultLockDialog (the same passcode boxes, lockout countdown and plain failure lines as the
// unlock) with the confirm's own words; the check is a FRESH passcode for this one clip (a ticket that works once, for thirty seconds), never the page's unlock.
import { useContext, useState, type ReactNode } from "react";
import { AdultLockDialog, type UnlockResult } from "@maipai/ui/src/elements/adult-lock";
import { Button } from "@maipai/ui/src/ui/button";
import { ApiError } from "@/lib/api";
import { adultCredential } from "@/lib/adultLock";
import { videosApi, type VideoItem } from "@/lib/videosApi";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

/** What will change, in plain words (the confirm dialog). `word` is the person's own word for their secret: "passcode" for a digit PIN, "password" for a password. */
export const unmarkExplainer = (word: string) => `This changes who can see it. It will show with its title and thumbnail in your feeds and lists, to anyone looking at your screen. People under 18 still never see it. Enter your ${word} to continue.`;
export const UNMARK_EXPLAINER = unmarkExplainer("passcode");

export function useVideoAdultMark(item: VideoItem | null, refresh: () => void): { actions: ReactNode[]; dialog: ReactNode; stateLine: string | null } {
  const me = useContext(WakeWordPersonContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const adult = item?.adult ?? null;
  const credential = adultCredential(me);
  if (!item || !adult) return { actions: [], dialog: null, stateLine: null };

  const check = async (passcode: string): Promise<UnlockResult> => {
    try {
      const { ticket } = await videosApi.confirmUnmark(item.id, passcode);
      await videosApi.adultMark(item.id, { action: "clear", ticket });
      return { status: "ok" };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return { status: "failed" };
      if (error instanceof ApiError && error.status === 429) return { status: "locked_out", retryAfterSeconds: error.retryAfter ?? 60 };
      throw error;
    }
  };
  const markAgain = () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    // A refusal is Home's own plain line (not an adult's own screen, not ready); never silence.
    void videosApi.adultMark(item.id, { action: "mark" }).catch((error: unknown) => setProblem(error instanceof ApiError ? error.message : "Could not mark it. Check your connection and try again.")).finally(() => { setBusy(false); refresh(); });
  };

  const actions: ReactNode[] = [];
  if (adult.can_clear) actions.push(<Button key="adult-unmark" type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Unmark as NSFW</Button>);
  if (adult.can_mark) actions.push(<Button key="adult-mark" type="button" variant="ghost" size="sm" disabled={busy} onClick={markAgain}>Mark as NSFW</Button>);
  const dialog = adult.can_clear ? (
    <AdultLockDialog
      key="adult-unmark-dialog"
      open={open}
      onOpenChange={setOpen}
      unlock={check}
      onUnlocked={() => { setOpen(false); refresh(); }}
      {...credential}
      hasCredential={me?.hasSecret !== false}
      title="Remove the adult lock?"
      description={unmarkExplainer(credential.credentialKind)}
      actionLabel="Remove lock"
    />
  ) : null;
  return { actions, dialog, stateLine: problem ?? adult.line };
}
