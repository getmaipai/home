// AUDIT-DUP-FE-01 (ADULT-LOCK-06/07): the one confirm-and-ticket flow behind the picture and the video "Mark as NSFW" / "Unmark as NSFW" controls.
// The two items differ only in the api object and in how an action is drawn (a gallery action or a ghost button), so `toAction` draws it.
import { createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { AdultLockDialog, type UnlockResult } from "@maipai/ui/src/elements/adult-lock";
import { ApiError } from "@/lib/api";
import { adultCredential } from "@/lib/adultLock";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { errorLine } from "@/lib/hubReachability";
import { getPasskeyAssertion, passkeysAvailable } from "@/lib/passkeyAssertion";

/** What will change, in plain words (the confirm dialog). `word` is the person's own word for their secret: "passcode" for a digit PIN, "password" for a password. */
export const unmarkExplainer = (word: string) => `This changes who can see it. It will show with its title and thumbnail in your feeds and lists, to anyone looking at your screen. People under 18 still never see it. Enter your ${word} to continue.`;
export const UNMARK_EXPLAINER = unmarkExplainer("passcode");

export interface AdultMarkApi {
  confirmUnmark: (item: string, credential: string | { passkey_assertion: unknown }) => Promise<{ ticket: string }>;
  adultMark: (id: string, body: { action: "clear" | "mark"; ticket?: string }) => Promise<unknown>;
}
export interface AdultMarkItem { id: string; adult?: { can_clear: boolean; can_mark: boolean; line: string | null } | null }
export interface AdultMarkAction { id: "adult-unmark" | "adult-mark"; label: string; hint: string | undefined; disabled: boolean; onSelect: () => void }

export function useAdultMark<T>(api: AdultMarkApi, item: AdultMarkItem | null, refresh: () => void, toAction: (action: AdultMarkAction) => T): { actions: T[]; dialog: ReactNode; stateLine: string | null } {
  const me = useContext(WakeWordPersonContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  useEffect(() => { let live = true; void passkeysAvailable().then((value) => { if (live) setPasskeyEnabled(value); }); return () => { live = false; }; }, []);
  const adult = item?.adult ?? null;
  const credential = adultCredential(me);
  if (!item || !adult) return { actions: [], dialog: null, stateLine: null };

  const checkCredential = async (credentialValue: string | { passkey_assertion: unknown }): Promise<UnlockResult> => {
    try {
      const { ticket } = await api.confirmUnmark(item.id, credentialValue);
      await api.adultMark(item.id, { action: "clear", ticket });
      return { status: "ok" };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return { status: "failed" };
      if (error instanceof ApiError && error.status === 429) return { status: "locked_out", retryAfterSeconds: error.retryAfter ?? 60 };
      throw error;
    }
  };
  const check = (secret: string) => checkCredential(secret);
  const onPasskey = async (): Promise<UnlockResult> => checkCredential({ passkey_assertion: await getPasskeyAssertion() });
  const markAgain = () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    // A refusal is Home's own plain line (not an adult's own screen, not ready); never silence.
    void api.adultMark(item.id, { action: "mark" }).catch((error: unknown) => setProblem(errorLine(error, "Could not mark it. Check your connection and try again."))).finally(() => { setBusy(false); refresh(); });
  };
  const hint = adult.line ?? undefined;
  const actions: T[] = [];
  if (adult.can_clear) actions.push(toAction({ id: "adult-unmark", label: "Unmark as NSFW", hint, disabled: busy, onSelect: () => setOpen(true) }));
  if (adult.can_mark) actions.push(toAction({ id: "adult-mark", label: "Mark as NSFW", hint, disabled: busy, onSelect: markAgain }));
  const dialog = adult.can_clear
    ? createElement(AdultLockDialog, {
      key: "adult-unmark-dialog",
      open,
      onOpenChange: setOpen,
      unlock: check,
      ...(passkeyEnabled ? { onPasskey } : {}),
      onUnlocked: () => { setOpen(false); refresh(); },
      ...credential,
      hasCredential: me?.hasSecret !== false,
      title: "Remove the adult lock?",
      description: unmarkExplainer(credential.credentialKind),
      actionLabel: "Remove lock",
    })
    : null;
  return { actions, dialog, stateLine: problem ?? adult.line };
}
