import { Button } from "@/kit/ui/button";

interface DestructiveConfirmProps {
  /** The bold question line, e.g. "Remove 3 people from your household?" */
  message: string;
  /** A second, explanatory line - what's actually lost, if anything
   * beyond the obvious. Optional: a few callers' own question already
   * says everything worth saying. */
  detail?: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}

// The kit's one destructive-confirmation block: a code review, 2026-09-06,
// found this exact bordered title/detail/buttons shape hand-copied four
// times (PeoplePage.tsx's batch remove, ConversationsPage.tsx's batch
// delete and clear-all, MemoryPage.tsx's forget) with nothing sharing an
// implementation - the same "a second copy of anything is wrong even
// when it is faster" standard BatchBar.tsx was already pulled out for.
// Deliberately NOT the per-row inline confirms those same pages also
// have (PeoplePage/ConversationsPage): those have no buttons of their
// own (a List's renderAction slot renders them separately), a genuinely
// different shape, not a fifth copy of this one.
export function DestructiveConfirm({
  message,
  detail,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  onCancel,
  cancelLabel = "Keep it",
}: DestructiveConfirmProps) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-destructive p-3">
      <p className="text-base font-medium">{message}</p>
      {detail ? <p className="text-base text-muted-foreground">{detail}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
