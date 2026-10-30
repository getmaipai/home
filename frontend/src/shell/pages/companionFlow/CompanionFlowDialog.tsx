import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { api } from "@/lib/api";
import { AnimateStep } from "@/shell/pages/companionFlow/AnimateStep";
import { CustomizeStep } from "@/shell/pages/companionFlow/CustomizeStep";
import { CreateCharacterStep } from "@/shell/pages/companionFlow/CreateCharacterStep";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

const STEPS = [
  { title: "Create Character", line: "Design your companion's appearance" },
  { title: "Animate Character", line: "Generate and review your animations" },
  { title: "Customize Companion", line: "Give your companion a voice, personality, and history" },
] as const;

/** The three-screen companion dialog. Screen 3 saves and publishes. `initialStep` (editing only) opens on a later screen. */
export function CompanionFlowDialog({ companionId, initialName, initialStep = 0 }: { companionId: string | null; initialName: string; initialStep?: number }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(companionId ? initialStep : 0);
  const [draft, setDraft] = useState<{ id: string | null; pictures: number; name: string }>({ id: companionId, pictures: 1, name: initialName });
  const [sheetJob, setSheetJob] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState(false);
  const [asking, setAsking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");
  const onDraft = useCallback((state: { id: string | null; pictures: number; name: string }) => setDraft(state), []);
  // The draft being made right now (the name field was just left); Close waits for it so the keep-or-discard question is never skipped.
  const creating: MutableRefObject<Promise<string> | null> = useRef(null);
  const leave = () => navigate("/companions");
  async function close() {
    const pending = creating.current;
    if (pending) {
      const id = await pending.catch(() => null);
      if (id) { setDraft((current) => ({ ...current, id })); setAsking(true); } else leave();
      return;
    }
    // A draft that holds no picture is clutter; ask once whether to keep it.
    if (draft.id && draft.pictures === 0) setAsking(true); else leave();
  }
  async function discard() {
    setDiscarding(true); setError("");
    try { await api.deleteCompanion(draft.id!); leave(); } catch (e) { setError(flowErrorText(e)); setDiscarding(false); }
  }
  const current = STEPS[step]!;
  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) void close(); }}>
      {/* Opening on a later screen (editing) puts focus on the dialog itself, not on whichever control comes first, so no control shows a stray focus ring. */}
      <DialogContent variant="flow" size={step === 0 ? "xl" : "default"} onInteractOutside={(event) => event.preventDefault()} onOpenAutoFocus={(event) => { if (initialStep > 0) { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus(); } }}>
        <DialogHeader>
          <DialogTitle size="xl">{current.title}</DialogTitle>
          <DialogDescription>{`Step ${step + 1} of 3 · ${current.line}`}</DialogDescription>
        </DialogHeader>
        <Progress mode="determinate" value={((step + 1) / 3) * 100} segments={3} tone="solid" size="md" label={`Step ${step + 1} of 3`} />
        {asking ? <DestructiveConfirm message="Keep this draft or discard it?" detail="A draft with no picture can wait in your list until you come back." confirmLabel="Discard" busyLabel="Discarding" cancelLabel="Keep draft" busy={discarding} onConfirm={() => void discard()} onCancel={leave} /> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div hidden={step !== 0}>
          <CreateCharacterStep creating={creating} companionId={companionId} initialName={initialName} onDraft={onDraft} onApproved={(job) => { setSheetJob(job); setJustApproved(true); setStep(1); }} />
        </div>
        {/* A plain box keeps the dialog scrolling when screen 2 is taller than the window; the flow dialog's flex column would otherwise squeeze its body over the footer. */}
        {step === 1 && draft.id ? <div className="flex flex-col gap-6"><AnimateStep companionId={draft.id} name={draft.name} sheetJob={sheetJob} autoMake={justApproved} onBack={() => setStep(0)} onContinue={() => setStep(2)} /></div> : null}
        {step === 2 && draft.id ? <div className="flex flex-col gap-6"><CustomizeStep companionId={draft.id} name={draft.name} onBack={() => setStep(1)} onGoTo={setStep} /></div> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}
