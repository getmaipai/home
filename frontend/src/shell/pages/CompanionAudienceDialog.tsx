import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Label } from "@maipai/ui/src/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { api } from "@/lib/api";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

type Audience = "adult" | "teen" | "all";
const CHECKLIST = [
  "I looked at the starting picture and every animation.",
  "Nothing in the pictures or the personality would scare or confuse a young child.",
  "I know Home checks the artwork again for children and says why if it does not pass.",
];

/** Admin only: who a companion is for. Making it for everyone needs the checklist; Home answers a refusal with one plain sentence and it shows here. */
export function CompanionAudienceDialog({ companionId, name, onClose }: { companionId: string; name: string; onClose: () => void }) {
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ["companions", companionId, "edit"], queryFn: () => api.editCompanion(companionId), retry: false });
  const [choice, setChoice] = useState<Audience | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const audience: Audience = choice ?? saved.data?.audience ?? "adult";
  const everyone = audience === "all";
  const ready = saved.data !== undefined && audience !== saved.data.audience && (!everyone || checked.every(Boolean));

  async function save() {
    setError(""); setBusy(true);
    try {
      await api.setCompanionAudience(companionId, { audience, ...(everyone ? { confirmed: true } : {}) });
      await Promise.all([client.invalidateQueries({ queryKey: ["companions"] }), client.invalidateQueries({ queryKey: ["companions", companionId, "edit"] })]);
      onClose();
    } catch (e) { setError(flowErrorText(e)); setBusy(false); }
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who is {name} for?</DialogTitle>
          <DialogDescription>Adults only, teens and adults, or everyone. Home checks the artwork again before it widens who can use a companion.</DialogDescription>
        </DialogHeader>
        {saved.isError ? <p role="alert" className="text-sm text-destructive">{flowErrorText(saved.error)}</p> : null}
        <ToggleGroup type="single" variant="segmented" fill value={audience} onValueChange={(next) => { if (next) setChoice(next as Audience); }} aria-label="Who can use this companion">
          <ToggleGroupItem value="adult">Adults only</ToggleGroupItem>
          <ToggleGroupItem value="teen">Teens and adults</ToggleGroupItem>
          <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
        </ToggleGroup>
        {everyone ? <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Before this companion is for everyone, check each one.</p>
          {CHECKLIST.map((line, index) => <div key={line} className="flex items-start gap-3">
            <Checkbox id={`all-ages-${index}`} checked={checked[index]} onCheckedChange={(value) => setChecked((old) => old.map((item, i) => i === index ? value === true : item))} />
            <Label htmlFor={`all-ages-${index}`}>{line}</Label>
          </div>)}
        </div> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" shape="pill" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button shape="pill" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving" : "Save audience"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
