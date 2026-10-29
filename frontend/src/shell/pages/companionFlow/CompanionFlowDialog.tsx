import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";
import { CreateCharacterStep } from "@/shell/pages/companionFlow/CreateCharacterStep";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

const STEPS = [
  { title: "Create Character", line: "Design your companion's appearance" },
  { title: "Animate Character", line: "Bring it to life" },
  { title: "Customize Companion", line: "Voice and personality" },
] as const;

/** The three-screen companion dialog. Screen 1 is built; screens 2 and 3 are placeholders until their slices land. */
export function CompanionFlowDialog({ companionId, initialName }: { companionId: string | null; initialName: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<{ id: string | null; pictures: number }>({ id: companionId, pictures: 1 });
  const [asking, setAsking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");
  const onDraft = useCallback((state: { id: string | null; pictures: number }) => setDraft(state), []);
  const leave = () => navigate("/companions");
  function close() {
    // A draft that holds no picture is clutter; ask once whether to keep it.
    if (draft.id && draft.pictures === 0) setAsking(true); else leave();
  }
  async function discard() {
    setDiscarding(true); setError("");
    try { await api.deleteCompanion(draft.id!); leave(); } catch (e) { setError(flowErrorText(e)); setDiscarding(false); }
  }
  const current = STEPS[step]!, Back = getIcon("arrow-left"), Next = getIcon("arrow-right");
  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent variant="flow">
        <DialogHeader>
          <DialogTitle size="xl">{current.title}</DialogTitle>
          <DialogDescription>{`Step ${step + 1} of 3 · ${current.line}`}</DialogDescription>
        </DialogHeader>
        <Progress mode="determinate" value={((step + 1) / 3) * 100} segments={3} tone="solid" size="md" label={`Step ${step + 1} of 3`} />
        {asking ? <DestructiveConfirm message="Keep this draft or discard it?" detail="A draft with no picture can wait in your list until you come back." confirmLabel="Discard" busyLabel="Discarding" cancelLabel="Keep draft" busy={discarding} onConfirm={() => void discard()} onCancel={leave} /> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div hidden={step !== 0}>
          <CreateCharacterStep companionId={companionId} initialName={initialName} onDraft={onDraft} onApproved={() => setStep(1)} />
        </div>
        {step > 0 ? <>
          <div className="rounded-3xl border p-8 text-center text-muted-foreground">This step comes next.</div>
          <DialogFooter align="between">
            <Button variant="outline" shape="pill" onClick={() => setStep(step - 1)}><Back aria-hidden="true" />Back</Button>
            {step < 2 ? <Button shape="pill" onClick={() => setStep(step + 1)}>Continue<Next aria-hidden="true" /></Button> : <span />}
          </DialogFooter>
        </> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}
