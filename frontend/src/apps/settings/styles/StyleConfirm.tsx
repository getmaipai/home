// VIDEO-LORA-08 (settings-media 5.3, video-loras 15.1 and 15.4): the one confirm panel before a style is downloaded. Picture, name (editable), source link, size,
// what it is made for, the licence line (a checkbox when the licence is not an open one), and "Is this style for adults only?". The pre-set follows the source's
// own check: safe says No, adult and unknown say Yes. All ages from an adult hit asks for a fresh passcode first. A style the household already has is "already added, open it".
import { i18n } from "@lingui/core";
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
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const sourceLine = (): Record<BrowseHit["adult_check"], string> => ({ normal: i18n._({ id: "The source says it is safe.", message: "The source says it is safe." }), adult: i18n._({ id: "The source marks this adult.", message: "The source marks this adult." }), unknown: i18n._({ id: "The source says nothing about age.", message: "The source says nothing about age." }) });
const licenceLine = (): Record<BrowseHit["licence"]["class"], string> => ({
  open: i18n._({ id: "Open licence. It lets a household use the style at home.", message: "Open licence. It lets a household use the style at home." }),
  non_commercial: i18n._({ id: "No-selling licence. You may use it at home, but not sell what you make with it.", message: "No-selling licence. You may use it at home, but not sell what you make with it." }),
  custom: i18n._({ id: "Custom licence. Read it on the source's page before you install.", message: "Custom licence. Read it on the source's page before you install." }),
  unknown: i18n._({ id: "The source does not state a licence. Read its page before you install.", message: "The source does not state a licence. Read its page before you install." }),
});

export function StyleConfirm({ hit, person, revealed, media = "video", onClose, onInstalled, onOpenInstalled }: {
  hit: BrowseHit; person: Roster; revealed: boolean; media?: "video" | "picture"; onClose: () => void; onInstalled: () => void; onOpenInstalled: (id: string | null) => void;
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
    source: hit.site, remote_id: hit.remote_id, version_id: hit.version_id, name: name.trim(), kind, media, audience: adultsOnly === "yes" ? "adult-only" : "all-ages", licence_confirmed: true,
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
      else setError(messageOf(e, i18n._({ id: "The download could not start. Check your connection, then try again.", message: "The download could not start. Check your connection, then try again." })));
      throw e;
    } finally { setBusy(false); }
  }
  const fresh = useFreshConfirm({
    person, item: hit.confirm_item, title: i18n._({ id: "Make this style all ages?", message: "Make this style all ages?" }), description: i18n._({ id: "Everyone who can use it will see its name and picture without a passcode. People under 18 still never see styles. Enter your passcode to continue.", message: "Everyone who can use it will see its name and picture without a passcode. People under 18 still never see styles. Enter your passcode to continue." }),
    actionLabel: i18n._({ id: "Make all ages", message: "Make all ages" }), run: (ticket) => install(ticket), onFailed: () => undefined,
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
            <DialogTitle size="xl">{i18n._({ id: "Add this style", message: "Add this style" })}</DialogTitle>
            <DialogDescription id="style-confirm-desc">{i18n._({ id: "Check what it is, then download it. It starts for admins only.", message: "Check what it is, then download it. It starts for admins only." })}</DialogDescription>
          </DialogHeader>
          <DialogBody columns="two">
            <div className="flex flex-col gap-4">
              <div className="aspect-video w-full overflow-hidden rounded-xl bg-muted"><StylePicture path={hit.preview} proof={revealed} /></div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="style-name">{i18n._({ id: "Name", message: "Name" })}</Label>
                <Input id="style-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy} />
              </div>
              <p className="text-sm text-muted-foreground">{hit.line}</p>
              {hit.page_url ? <a className="text-sm underline" href={hit.page_url} target="_blank" rel="noreferrer">{i18n._({ id: "Open its page on {value}", message: "Open its page on {value}", values: { value: hit.site === "civitai" ? i18n._({ id: "Civitai", message: "Civitai" }) : i18n._({ id: "Hugging Face", message: "Hugging Face" }) } })}</a> : null}
              {hit.also_on.length ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Also on {join}.", message: "Also on {join}.", values: { join: hit.also_on.join(" and ") } })}</p> : null}
            </div>
            <div className="flex flex-col gap-5">
              <DialogSection title={i18n._({ id: "Made for", message: "Made for" })}>
                <p className="text-sm">{needsBase ? (hit.base_unstated ? `${hit.reason ?? ""}.` : i18n._({ id: "Home could not tell what this style was made for.", message: "Home could not tell what this style was made for." })) : i18n._({ id: "{label}. {size}.", message: "{label}. {size}.", values: { label: hit.base_label, size: sizeWords(hit.bytes ?? 0) } })}</p>
                {needsBase ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="style-base">{i18n._({ id: "What was this style made for?", message: "What was this style made for?" })}</Label>
                    <Select value={base} onValueChange={(v) => setBase(v as "ltx-2.5" | "wan2.2-ti2v-5b")}>
                      <SelectTrigger id="style-base"><SelectValue placeholder={i18n._({ id: "Pick one", message: "Pick one" })} /></SelectTrigger>
                      <SelectContent><SelectItem value="ltx-2.5">{i18n._({ id: "LTX-2.5", message: "LTX-2.5" })}</SelectItem><SelectItem value="wan2.2-ti2v-5b">{i18n._({ id: "Wan", message: "Wan" })}</SelectItem></SelectContent>
                    </Select>
                  </div>
                ) : null}
                {hit.site === "civitai" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="style-kind">{i18n._({ id: "Kind", message: "Kind" })}</Label>
                    <Select value={kind} onValueChange={(v) => setKind(v as "style" | "character")}>
                      <SelectTrigger id="style-kind"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="style">{i18n._({ id: "Style", message: "Style" })}</SelectItem><SelectItem value="character">{i18n._({ id: "Character", message: "Character" })}</SelectItem></SelectContent>
                    </Select>
                  </div>
                ) : null}
              </DialogSection>
              <DialogSection title={i18n._({ id: "Licence", message: "Licence" })}>
                <p className="text-sm">{licenceLine()[hit.licence.class]}</p>
                {open ? null : (
                  <div className="flex items-start gap-2">
                    <Checkbox id="style-read" checked={read} onCheckedChange={(v) => setRead(v === true)} disabled={busy} />
                    <Label htmlFor="style-read" className="leading-snug">{i18n._({ id: "I have read the licence and it lets us use this style at home", message: "I have read the licence and it lets us use this style at home" })}</Label>
                  </div>
                )}
              </DialogSection>
              <DialogSection title={i18n._({ id: "Is this style for adults only?", message: "Is this style for adults only?" })}>
                <RadioGroup value={adultsOnly} onValueChange={(v) => setAdultsOnly(v as "yes" | "no")} aria-label={i18n._({ id: "Is this style for adults only?", message: "Is this style for adults only?" })}>
                  <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="style-adult-yes" /><Label htmlFor="style-adult-yes">{i18n._({ id: "Yes, adults only", message: "Yes, adults only" })}</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="no" id="style-adult-no" /><Label htmlFor="style-adult-no">{i18n._({ id: "No, all ages", message: "No, all ages" })}</Label></div>
                </RadioGroup>
                <p className="text-sm text-muted-foreground">{sourceLine()[hit.adult_check]} {adultsOnly === "no" && hit.adult_check === "adult" ? i18n._({ id: "Choosing all ages asks for your passcode again.", message: "Choosing all ages asks for your passcode again." }) : null}</p>
              </DialogSection>
              {hit.installed ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">{i18n._({ id: "You already have this as {name}.", message: "You already have this as {name}.", values: { name: hit.installed.name } })}<Button type="button" variant="outline" size="sm" onClick={() => onOpenInstalled(hit.installed!.id)}>{i18n._({ id: "Open it", message: "Open it" })}</Button></span></AlertDescription></Alert>
              ) : blocked ? <Alert><AlertDescription>{blocked}.</AlertDescription></Alert> : null}
              {duplicate ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">{duplicate.line}<Button type="button" variant="outline" size="sm" onClick={() => onOpenInstalled(duplicate.id)}>{i18n._({ id: "Open it", message: "Open it" })}</Button></span></AlertDescription></Alert>
              ) : null}
              {changed ? (
                <Alert><AlertDescription><span className="flex flex-wrap items-center gap-3">{i18n._({ id: "The source changed this file since you installed it.", message: "The source changed this file since you installed it." })}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void install(undefined, true).catch(() => undefined)}>{i18n._({ id: "Install as a separate style", message: "Install as a separate style" })}</Button></span></AlertDescription></Alert>
              ) : null}
              {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={!canInstall} onClick={start}>{busy ? i18n._({ id: "Starting the download…", message: "Starting the download…" }) : i18n._({ id: "Install style", message: "Install style" })}</Button>
                  <Button type="button" variant="outline" onClick={onClose}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
                </div>
                <p className="text-sm text-muted-foreground">{i18n._({ id: "It starts for admins only. You choose who else can use it after you try it.", message: "It starts for admins only. You choose who else can use it after you try it." })}</p>
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
