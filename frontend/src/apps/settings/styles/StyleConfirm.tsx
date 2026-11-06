// VIDEO-LORA-08 (settings-media 5.3, video-loras 15.1 and 15.4): the one confirm panel before a style is downloaded. Picture, name (editable), source link, size,
// what it is made for, the licence line (a checkbox when the licence is not an open one), and "Is this style for adults only?". The pre-set follows the source's
// own check: safe says No, adult and unknown say Yes. All ages from an adult hit asks for a fresh passcode first. A style the household already has is "already added, open it".
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogSection, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { ApiError, type Roster } from "@/lib/api";
import { useFreshConfirm } from "@/apps/settings/styles/FreshConfirm";
import { stylesApi, type BrowseHit, type InstallBody } from "@/apps/settings/styles/stylesApi";
import { messageOf, sizeWords, StylePicture } from "@/apps/settings/styles/stylesShared";

const SOURCE_LINE = { normal: "The source says it is safe.", adult: "The source marks this adult.", unknown: "The source says nothing about age." } as const;
const LICENCE_LINE = {
  open: "Open licence. It lets a household use the style at home.",
  non_commercial: "No-selling licence. You may use it at home, but not sell what you make with it.",
  custom: "Custom licence. Read it on the source's page before you install.",
  unknown: "The source does not state a licence. Read its page before you install.",
} as const;

export function StyleConfirm({ hit, person, revealed, onClose, onInstalled, onOpenInstalled }: {
  hit: BrowseHit; person: Roster; revealed: boolean; onClose: () => void; onInstalled: () => void; onOpenInstalled: (id: string | null) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(hit.title.slice(0, 80));
  const [kind, setKind] = useState<"style" | "character">(hit.kind === "character" ? "character" : "style");
  const [adultsOnly, setAdultsOnly] = useState<"yes" | "no">(hit.adult_check === "normal" ? "no" : "yes");
  const [read, setRead] = useState(false);
  const needsBase = hit.base_model !== "ltx-2.5" && hit.base_model !== "wan2.2-ti2v-5b";
  const [base, setBase] = useState<"ltx-2.5" | "wan2.2-ti2v-5b" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string | null; line: string } | null>(null);
  const open = licenceIsOpen(hit);
  const blocked = hit.reason && !hit.installed && !hit.base_unstated ? hit.reason : null;
  const canInstall = !busy && !blocked && !hit.installed && name.trim().length > 0 && (open || read) && (!needsBase || base !== "");

  const body = (ticket?: string, separate?: boolean): InstallBody => ({
    source: hit.site, remote_id: hit.remote_id, version_id: hit.version_id, name: name.trim(), kind, audience: adultsOnly === "yes" ? "adult-only" : "all-ages", licence_confirmed: true,
    ...(needsBase && base ? { base_model: base } : {}), ...(ticket ? { confirm_ticket: ticket } : {}), ...(separate ? { as_separate: true } : {}),
  });
  async function install(ticket?: string, separate?: boolean) {
    setBusy(true); setError(null);
    try {
      await stylesApi.install(body(ticket, separate));
      void client.invalidateQueries({ queryKey: ["style-installs"] });
      onInstalled();
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") setDuplicate({ id: e.existingId ?? null, line: e.message });
      else if (e instanceof ApiError && e.code === "changed_file") setChanged(true);
      else setError(messageOf(e, "The download could not start. Check your connection, then try again."));
      throw e;
    } finally { setBusy(false); }
  }
  const fresh = useFreshConfirm({
    person, item: hit.confirm_item, title: "Make this style all ages?", description: "Everyone who can use it will see its name and picture without a passcode. People under 18 still never see styles. Enter your passcode to continue.",
    actionLabel: "Make all ages", run: (ticket) => install(ticket), onFailed: () => undefined,
  });
  const start = () => {
    if (adultsOnly === "no" && hit.adult_check === "adult") { fresh.ask(); return; }
    void install().catch(() => undefined);
  };

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent variant="flow" aria-describedby="style-confirm-desc" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle size="xl">Add this style</DialogTitle>
            <DialogDescription id="style-confirm-desc">Check what it is, then download it. It starts for admins only.</DialogDescription>
          </DialogHeader>
          <DialogBody columns="two">
            <div className="flex flex-col gap-4">
              <div className="aspect-video w-full overflow-hidden rounded-xl bg-muted"><StylePicture path={hit.preview} proof={revealed} /></div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="style-name">Name</Label>
                <Input id="style-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy} />
              </div>
              <p className="text-sm text-muted-foreground">{hit.line}</p>
              {hit.page_url ? <a className="text-sm underline" href={hit.page_url} target="_blank" rel="noreferrer">Open its page on {hit.site === "civitai" ? "Civitai" : "Hugging Face"}</a> : null}
              {hit.also_on.length ? <p className="text-sm text-muted-foreground">Also on {hit.also_on.join(" and ")}.</p> : null}
            </div>
            <div className="flex flex-col gap-5">
              <DialogSection title="Made for">
                <p className="text-sm">{needsBase ? (hit.base_unstated ? `${hit.reason ?? ""}.` : "Home could not tell what this style was made for.") : `${hit.base_label}. ${sizeWords(hit.bytes ?? 0)}.`}</p>
                {needsBase ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="style-base">What was this style made for?</Label>
                    <Select value={base} onValueChange={(v) => setBase(v as "ltx-2.5" | "wan2.2-ti2v-5b")}>
                      <SelectTrigger id="style-base"><SelectValue placeholder="Pick one" /></SelectTrigger>
                      <SelectContent><SelectItem value="ltx-2.5">LTX-2.5</SelectItem><SelectItem value="wan2.2-ti2v-5b">Wan</SelectItem></SelectContent>
                    </Select>
                  </div>
                ) : null}
                {hit.site === "civitai" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="style-kind">Kind</Label>
                    <Select value={kind} onValueChange={(v) => setKind(v as "style" | "character")}>
                      <SelectTrigger id="style-kind"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="style">Style</SelectItem><SelectItem value="character">Character</SelectItem></SelectContent>
                    </Select>
                  </div>
                ) : null}
              </DialogSection>
              <DialogSection title="Licence">
                <p className="text-sm">{LICENCE_LINE[hit.licence.class]}</p>
                {open ? null : (
                  <div className="flex items-start gap-2">
                    <Checkbox id="style-read" checked={read} onCheckedChange={(v) => setRead(v === true)} disabled={busy} />
                    <Label htmlFor="style-read" className="leading-snug">I have read the licence and it lets us use this style at home</Label>
                  </div>
                )}
              </DialogSection>
              <DialogSection title="Is this style for adults only?">
                <RadioGroup value={adultsOnly} onValueChange={(v) => setAdultsOnly(v as "yes" | "no")} aria-label="Is this style for adults only?">
                  <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="style-adult-yes" /><Label htmlFor="style-adult-yes">Yes, adults only</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="no" id="style-adult-no" /><Label htmlFor="style-adult-no">No, all ages</Label></div>
                </RadioGroup>
                <p className="text-sm text-muted-foreground">{SOURCE_LINE[hit.adult_check]} {adultsOnly === "no" && hit.adult_check === "adult" ? "Choosing all ages asks for your passcode again." : null}</p>
              </DialogSection>
              {hit.installed ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">You already have this as {hit.installed.name}.<Button type="button" variant="outline" size="sm" onClick={() => onOpenInstalled(hit.installed!.id)}>Open it</Button></span></AlertDescription></Alert>
              ) : blocked ? <Alert><AlertDescription>{blocked}.</AlertDescription></Alert> : null}
              {duplicate ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">{duplicate.line}<Button type="button" variant="outline" size="sm" onClick={() => onOpenInstalled(duplicate.id)}>Open it</Button></span></AlertDescription></Alert>
              ) : null}
              {changed ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">The source changed this file since you installed it.<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void install(undefined, true).catch(() => undefined)}>Install as a separate style</Button></span></AlertDescription></Alert>
              ) : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={!canInstall} onClick={start}>{busy ? "Starting the download…" : "Install style"}</Button>
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                </div>
                <p className="text-sm text-muted-foreground">It starts for admins only. You choose who else can use it after you try it.</p>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
      {fresh.dialog}
    </>
  );
}

export const licenceIsOpen = (hit: Pick<BrowseHit, "licence">): boolean => hit.licence.class === "open";
