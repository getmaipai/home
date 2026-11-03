// VIDEO-LORA-08 (settings-media 5.4): "Add from a file". One confirm panel (name, the file, the licence line and the adults-only question) in the same words as the
// browser's. The file is checked by the engine when it arrives. A file's age is never known, so the pre-set is Yes, adults only, and choosing All ages needs the unlock.
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogSection, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { useLockProof } from "@maipai/ui/src/elements/adult-lock";
import { stylesApi } from "@/apps/settings/styles/stylesApi";
import { messageOf } from "@/apps/settings/styles/stylesShared";

export function StyleAddFile({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const lock = useLockProof();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState(false);
  const [adultsOnly, setAdultsOnly] = useState<"yes" | "no">("yes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.append("name", name.trim() || file.name.replace(/\.safetensors$/i, ""));
    form.append("licence", "Added from a file");
    form.append("licence_acknowledged", read ? "true" : "false");
    form.append("classification", adultsOnly === "no" ? "all-ages" : "adult-only");
    form.append("file", file, file.name);
    try { await stylesApi.addFile(form); onAdded(); }
    catch (e) { setError(messageOf(e, "The style could not be added. Check that the engine is running, then try again.")); }
    finally { setBusy(false); }
  }

  return (
    <>
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent variant="flow" aria-describedby="style-file-desc" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle size="xl">Add from a file</DialogTitle>
          <DialogDescription id="style-file-desc">Styles come as .safetensors files. Home checks the file before it can be used.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <DialogBody>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2"><Label htmlFor="sf-file">The .safetensors file</Label><Input id="sf-file" type="file" accept=".safetensors" required disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
              <div className="flex flex-col gap-2"><Label htmlFor="sf-name">Name</Label><Input id="sf-name" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Old colour film" /></div>
              <DialogSection title="Licence">
                <div className="flex items-start gap-2">
                  <Checkbox id="sf-read" checked={read} onCheckedChange={(v) => setRead(v === true)} disabled={busy} />
                  <Label htmlFor="sf-read" className="leading-snug">I have read the licence and it lets us use this style at home</Label>
                </div>
              </DialogSection>
              <DialogSection title="Is this style for adults only?">
                <RadioGroup value={adultsOnly} onValueChange={(v) => setAdultsOnly(v as "yes" | "no")} aria-label="Is this style for adults only?">
                  <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="sf-adult-yes" /><Label htmlFor="sf-adult-yes">Yes, adults only</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="no" id="sf-adult-no" disabled={!lock.unlocked} /><Label htmlFor="sf-adult-no">No, all ages</Label></div>
                </RadioGroup>
                <p className="text-sm text-muted-foreground">A file never says what age it is for. {lock.unlocked ? "" : "Unlock on the Styles page first to choose all ages."}</p>
              </DialogSection>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !file || !read}>{busy ? "Adding…" : "Add style"}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
                <p className="text-sm text-muted-foreground">It starts for admins only. You choose who else can use it after you try it.</p>
              </div>
            </div>
          </DialogBody>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
