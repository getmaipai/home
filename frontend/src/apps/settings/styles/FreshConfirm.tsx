// VIDEO-LORA-08: the fresh-passcode step for lowering an adult style (design 15.1, docs/dev/adult-lock.md "Auto-mark, unmark"). It is the kit's AdultLockDialog with
// the confirm's own words, the same one the chat video card uses; the check asks for a single-use ticket bound to one item (never the page's unlock) and runs the action
// that needs it. A wrong code or a lockout is shown by the dialog; any other failure is shown on the screen that asked.
import { useState, type ReactNode } from "react";
import { AdultLockDialog, type UnlockResult } from "@maipai/ui/src/elements/adult-lock";
import { ApiError, type Roster } from "@/lib/api";
import { adultCredential } from "@/lib/adultLock";
import { stylesApi } from "@/apps/settings/styles/stylesApi";

/** The fresh-passcode dialog as a hook: `dialog` is drawn once by the caller, `ask()` opens it. */
export function useFreshConfirm({ person, item, title, description, actionLabel, run, onFailed }: {
  person: Pick<Roster, "pinDigits" | "hasSecret">; item: string;
  title: string; description: string; actionLabel: string; run: (ticket: string) => Promise<void>; onFailed: (error: unknown) => void;
}): { ask: () => void; dialog: ReactNode } {
  const [open, onOpenChange] = useState(false);
  const credential = adultCredential(person);
  const check = async (secret: string): Promise<UnlockResult> => {
    let ticket: string;
    try { ticket = (await stylesApi.confirmTicket(secret, item)).ticket; }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) return { status: "failed" };
      if (error instanceof ApiError && error.status === 429) return { status: "locked_out", retryAfterSeconds: error.retryAfter ?? 60 };
      throw error;
    }
    try { await run(ticket); } catch (error) { onFailed(error); }
    return { status: "ok" };
  };
  const dialog = <AdultLockDialog open={open} onOpenChange={onOpenChange} unlock={check} onUnlocked={() => onOpenChange(false)} {...credential} hasCredential={person.hasSecret !== false} title={title} description={description} actionLabel={actionLabel} />;
  return { ask: () => onOpenChange(true), dialog };
}
