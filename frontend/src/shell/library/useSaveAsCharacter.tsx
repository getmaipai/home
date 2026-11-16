import { i18n } from "@lingui/core";
// SAVE-CHARACTER-01: "Save as a character" in the Library viewer. One small dialog asks for a name, the hub saves the picture as a character
// (POST /api/media-subjects/from-picture) and starts its look capture; the dialog then says so and links to the Characters page.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input as KitInput } from "@maipai/ui/src/ui/input";
import { Label as KitLabel } from "@maipai/ui/src/ui/label";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

export const CHARACTER_NAME_MAX = 60;
export const CHARACTERS_PATH = "/apps/image/characters";

/** The button shows for a picture its owner can open right now: not someone else's, not a locked Adult picture, and not for a guest. */
export function canSaveAsCharacter(item: LibraryItem, me: Roster): boolean {
  return item.kind === "image" && item.owner.id === me.id && me.role !== "guest" && !(item.audience === "adult-only" && item.unlocked !== true);
}

export function useSaveAsCharacter(item: LibraryItem) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const trimmed = name.trim();
  const change = (next: boolean) => { setOpen(next); if (!next) { setName(""); setProblem(""); setSaved(null); } };
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true); setProblem("");
    try { const made = await api.saveAsCharacter(item.id, trimmed); setSaved(made.line); }
    catch (error) { setProblem(errorLine(error, i18n._({ id: "The character could not be saved. Try again in a minute.", message: "The character could not be saved. Try again in a minute." }))); }
    finally { setBusy(false); }
  };
  const dialog = (
    <Dialog open={open} onOpenChange={change}><DialogContent><DialogHeader><DialogTitle>{i18n._({ id: "Save as a character", message: "Save as a character" })}</DialogTitle></DialogHeader>
      {saved === null ? (
        <>
          <div className="flex flex-col gap-2">
            <KitLabel htmlFor="character-name">{i18n._({ id: "Name", message: "Name" })}</KitLabel>
            <KitInput id="character-name" value={name} maxLength={CHARACTER_NAME_MAX} autoComplete="off" placeholder={i18n._({ id: "Juniper", message: "Juniper" })} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} />
            <p className="text-supporting text-muted-foreground">{i18n._({ id: "This picture becomes the character. Use the name with @ in chat or on Create.", message: "This picture becomes the character. Use the name with @ in chat or on Create." })}</p>
          </div>
          {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
          <DialogFooter><Button type="button" disabled={busy || !trimmed} onClick={() => void submit()}>{i18n._({ id: "Save character", message: "Save character" })}</Button></DialogFooter>
        </>
      ) : (
        <>
          <p role="status" className="text-body">{i18n._({ id: "Saved as a character", message: "Saved as a character" })}</p>
          <p className="text-supporting text-muted-foreground">{saved}</p>
          <DialogFooter><Button asChild><Link to={CHARACTERS_PATH}>{i18n._({ id: "Open", message: "Open" })}</Link></Button></DialogFooter>
        </>
      )}
    </DialogContent></Dialog>
  );
  return { openDialog: () => setOpen(true), dialog };
}
