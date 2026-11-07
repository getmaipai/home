// VIDEO-LORA-08 (settings-media 5.5): the style editor, a kit Dialog (flow) so an unlocked page is never left. About, Try this style and Remove, Who can use it
// (and the Adults only switch), Added to the prompt, Avoid with Say instead, Strength, Details. Every change saves at once and says so. Turning Adults only on
// is free; turning it off asks, and asks for the passcode again when the source said adult (design 15.1).
import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogSection, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { PhraseListField, PhrasePairsField, type PhrasePair } from "@maipai/ui/src/settings/PhraseListField";
import { PersonMultiSelect, type PersonOption } from "@maipai/ui/src/settings/PersonMultiSelect";
import { requestJson, type Roster } from "@/lib/api";
import { useFreshConfirm } from "@/apps/settings/styles/FreshConfirm";
import { baseWords, stylesApi, type BaseModelId, type StylePatch, type StyleRow, type StyleWho } from "@/apps/settings/styles/stylesApi";
import { adultCheckLine, filePath, messageOf, sizeWords, StylePicture } from "@/apps/settings/styles/stylesShared";

const pairsOf = (row: StyleRow): PhrasePair[] => row.negative_addins.map((avoid, i) => ({ avoid, say: row.avoid_as_positive[i] ?? "" }));

/** VIDEO-LORA-09: "Try this style" opens Create with the style chosen, as router state the page reads into its own state (never the address). A character goes to the Characters choice, any other kind to Styles. */
export function tryStyleState(row: Pick<StyleRow, "id" | "kind">): { pageState: Record<string, string> } {
  return { pageState: { [row.kind === "character" ? "character" : "style"]: row.id } };
}

export function StyleEditor({ row, person, onClose, onChanged }: { row: StyleRow; person: Roster; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [people, setPeople] = useState<string[]>(row.availability.people);
  const [strength, setStrength] = useState({ default: String(row.strength.default), min: String(row.strength.min), max: String(row.strength.max) });
  const [askRemove, setAskRemove] = useState(false);
  const [askLower, setAskLower] = useState(false);
  const roster = useQuery({ queryKey: ["people"], queryFn: () => requestJson<Array<PersonOption & { age_band?: string; role?: string }>>("/api/people") });
  // Adults only: a minor id can never be chosen (the writer refuses one as well).
  const adults = useMemo<PersonOption[]>(() => (roster.data ?? []).filter((p) => p.age_band === "adult" && p.role !== "guest"), [roster.data]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function save(patch: StylePatch, what = i18n._({ id: "Saved.", message: "Saved." })) {
    setStatus(null);
    try { await stylesApi.patch(row.id, patch); setStatus({ ok: true, text: what }); onChanged(); }
    catch (e) { setStatus({ ok: false, text: messageOf(e, i18n._({ id: "Home could not save that. Check the Home connection, then try again.", message: "Home could not save that. Check the Home connection, then try again." })) }); }
  }
  async function act(run: () => Promise<unknown>, done: string, fallback: string) {
    setStatus(null);
    try { await run(); setStatus({ ok: true, text: done }); onChanged(); }
    catch (e) { setStatus({ ok: false, text: messageOf(e, fallback) }); }
  }
  const who = row.availability.who;
  const setWho = (next: StyleWho) => {
    if (next === "people" && people.length === 0) { void save({ availability: { who: "people", people: [] } }, i18n._({ id: "Saved. Choose who below.", message: "Saved. Choose who below." })); return; }
    void save({ availability: { who: next, people: next === "people" ? people : [] } });
  };
  const fresh = useFreshConfirm({
    person, item: row.id, title: i18n._({ id: "Make this style all ages?", message: "Make this style all ages?" }), description: i18n._({ id: "The source marked this style adult. Enter your passcode again to make it all ages.", message: "The source marked this style adult. Enter your passcode again to make it all ages." }),
    actionLabel: i18n._({ id: "Make all ages", message: "Make all ages" }), run: async (ticket) => { await stylesApi.markAllAges(row.id, ticket); setStatus({ ok: true, text: i18n._({ id: "Now all ages.", message: "Now all ages." }) }); onChanged(); },
    onFailed: (e) => setStatus({ ok: false, text: messageOf(e, i18n._({ id: "Home could not change that. Try again.", message: "Home could not change that. Try again." })) }),
  });
  const lowerAdult = () => { if (row.adult_check === "adult") fresh.ask(); else void act(() => stylesApi.markAllAges(row.id), i18n._({ id: "Now all ages.", message: "Now all ages." }), i18n._({ id: "Home could not change that. Try again.", message: "Home could not change that. Try again." })); };

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent variant="flow" size="xl" aria-describedby="style-editor-desc" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle size="xl">{row.name}</DialogTitle>
            <DialogDescription id="style-editor-desc">{i18n._({ id: "Changes save as you make them.", message: "Changes save as you make them." })}</DialogDescription>
          </DialogHeader>
          <div role="status" aria-live="polite" className={status && !status.ok ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{status?.text ?? ""}</div>
          <DialogBody columns="two">
            <div className="flex flex-col gap-6">
              <DialogSection title={i18n._({ id: "About", message: "About" })}>
                <div className="aspect-video w-full max-w-sm overflow-hidden rounded-xl bg-muted"><StylePicture path={filePath(row.preview_file_id)} proof={row.audience === "adult-only"} /></div>
                <div className="flex flex-col gap-2"><Label htmlFor="se-name">{i18n._({ id: "Name", message: "Name" })}</Label><Input id="se-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { const t = name.trim(); if (t && t !== row.name) void save({ name: t }); }} /></div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="se-desc">{i18n._({ id: "What it does", message: "What it does" })}</Label>
                  <Input id="se-desc" value={description} maxLength={140} onChange={(e) => setDescription(e.target.value)} onBlur={() => { if (description.trim() !== row.description) void save({ description: description.trim() }); }} />
                  <p className="text-sm text-muted-foreground">{i18n._({ id: "{length} of 140 characters", message: "{length} of 140 characters", values: { length: description.length } })}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="se-kind">{i18n._({ id: "Kind", message: "Kind" })}</Label>
                  <Select value={row.kind} onValueChange={(v) => void save({ kind: v as StyleRow["kind"] })}>
                    <SelectTrigger id="se-kind"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="style">{i18n._({ id: "Style", message: "Style" })}</SelectItem><SelectItem value="character">{i18n._({ id: "Character", message: "Character" })}</SelectItem><SelectItem value="motion">{i18n._({ id: "Motion", message: "Motion" })}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={!row.usable || row.base_model === "ltx-2.3"} onClick={() => navigate("/apps/videos/create", { state: tryStyleState(row) })}>{i18n._({ id: "Try this style", message: "Try this style" })}</Button>
                  <Button type="button" variant="outline" onClick={() => setAskRemove(true)}>{i18n._({ id: "Remove", message: "Remove" })}</Button>
                </div>
              </DialogSection>
              <DialogSection title={i18n._({ id: "Who can use it", message: "Who can use it" })}>
                {row.needs_confirmation ? (
                  <Alert><AlertDescription><span className="flex flex-col items-start gap-2">{i18n._({ id: "Read the licence and fingerprint under Details, then confirm them. Until you do, only admins can use this style.", message: "Read the licence and fingerprint under Details, then confirm them. Until you do, only admins can use this style." })}<Button type="button" size="sm" variant="outline" onClick={() => void act(() => stylesApi.confirmLicence(row.id), i18n._({ id: "Confirmed.", message: "Confirmed." }), i18n._({ id: "Home could not confirm that. Try again.", message: "Home could not confirm that. Try again." }))}>{i18n._({ id: "I have read them", message: "I have read them" })}</Button></span></AlertDescription></Alert>
                ) : null}
                <RadioGroup value={who} onValueChange={(v) => setWho(v as StyleWho)} aria-label={i18n._({ id: "Who can use this style", message: "Who can use this style" })} disabled={row.base_model === "ltx-2.3"}>
                  {([["admins", i18n._({ id: "Only admins", message: "Only admins" })], ["adults", i18n._({ id: "All adults", message: "All adults" })], ["people", i18n._({ id: "Chosen people", message: "Chosen people" })]] as const).map(([v, text]) => (
                    <div key={v} className="flex items-center gap-2"><RadioGroupItem value={v} id={`se-who-${v}`} disabled={v !== "admins" && row.needs_confirmation} /><Label htmlFor={`se-who-${v}`}>{text}</Label></div>
                  ))}
                </RadioGroup>
                {row.base_model === "ltx-2.3" ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Retired video model, no longer available", message: "Retired video model, no longer available" })}</p> : null}
                {who === "people" ? (
                  <PersonMultiSelect ariaLabel={i18n._({ id: "Chosen people", message: "Chosen people" })} people={adults} value={people} onValueChange={(ids) => { setPeople(ids); void save({ availability: { who: "people", people: ids } }); }} />
                ) : null}
                <div className="flex items-center gap-3">
                  <Switch id="se-adult" checked={row.audience === "adult-only"} aria-label={i18n._({ id: "Adults only", message: "Adults only" })}
                    onCheckedChange={(on) => { if (on) void act(() => stylesApi.markAdultOnly(row.id), i18n._({ id: "Now adults only.", message: "Now adults only." }), i18n._({ id: "Home could not change that. Try again.", message: "Home could not change that. Try again." })); else setAskLower(true); }} />
                  <Label htmlFor="se-adult">{i18n._({ id: "Adults only", message: "Adults only" })}</Label>
                </div>
                <p className="text-sm text-muted-foreground">{i18n._({ id: "{adultCheckLine} People under 18 never see styles.", message: "{adultCheckLine} People under 18 never see styles.", values: { adultCheckLine: adultCheckLine(row.adult_check) } })}</p>
              </DialogSection>
            </div>
            <div className="flex flex-col gap-6">
              <DialogSection title={i18n._({ id: "Added to the prompt", message: "Added to the prompt" })}>
                <PhraseListField label={i18n._({ id: "Words that switch it on", message: "Words that switch it on" })} help={i18n._({ id: "Home adds these to the person's words when they pick this style.", message: "Home adds these to the person's words when they pick this style." })} value={row.trigger_words} addLabel={i18n._({ id: "Add a word", message: "Add a word" })} maxItems={12} maxItemChars={80} onChange={(v) => void save({ trigger_words: v })} />
                <PhraseListField label={i18n._({ id: "Also add", message: "Also add" })} help={i18n._({ id: "Phrases added to the person's words, never replacing them.", message: "Phrases added to the person's words, never replacing them." })} value={row.positive_addins} addLabel={i18n._({ id: "Add a phrase", message: "Add a phrase" })} maxItems={8} maxItemChars={120} maxTotalChars={400} onChange={(v) => void save({ positive_addins: v })} />
                <Collapsible>
                  <CollapsibleTrigger asChild><Button type="button" variant="link">{i18n._({ id: "More", message: "More" })}</Button></CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col gap-2 pt-2"><Label htmlFor="se-pos">{i18n._({ id: "Where the words go", message: "Where the words go" })}</Label>
                    <Select value={row.trigger_position} onValueChange={(v) => void save({ trigger_position: v as "start" | "end" })}>
                      <SelectTrigger id="se-pos"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="start">{i18n._({ id: "At the start", message: "At the start" })}</SelectItem><SelectItem value="end">{i18n._({ id: "At the end", message: "At the end" })}</SelectItem></SelectContent>
                    </Select></div>
                  </CollapsibleContent>
                </Collapsible>
              </DialogSection>
              <DialogSection title={i18n._({ id: "Avoid", message: "Avoid" })}>
                <PhrasePairsField label={i18n._({ id: "Avoid, and say this instead", message: "Avoid, and say this instead" })} help={i18n._({ id: "Videos at Standard and Boost cannot use avoid words. Say the opposite instead.", message: "Videos at Standard and Boost cannot use avoid words. Say the opposite instead." })} value={pairsOf(row)} firstLabel={i18n._({ id: "Avoid", message: "Avoid" })} secondLabel={i18n._({ id: "Say instead", message: "Say instead" })} addLabel={i18n._({ id: "Add a pair", message: "Add a pair" })} maxItems={8} maxItemChars={120} maxTotalChars={400}
                  onChange={(v) => void save({ negative_addins: v.map((p) => p.avoid), avoid_as_positive: v.map((p) => p.say) })} />
              </DialogSection>
              <DialogSection title={i18n._({ id: "Strength", message: "Strength" })}>
                <div className="grid grid-cols-3 gap-3">
                  {(["default", "min", "max"] as const).map((field) => (
                    <div key={field} className="flex flex-col gap-1.5">
                      <Label htmlFor={`se-str-${field}`}>{field === "default" ? i18n._({ id: "Normal", message: "Normal" }) : field === "min" ? i18n._({ id: "Lowest", message: "Lowest" }) : i18n._({ id: "Highest", message: "Highest" })}</Label>
                      <Input id={`se-str-${field}`} inputMode="decimal" value={strength[field]} onChange={(e) => setStrength({ ...strength, [field]: e.target.value })}
                        onBlur={() => { const n = Number(strength[field]); if (Number.isFinite(n) && n >= 0 && n <= 2 && n !== row.strength[field]) void save({ strength: { [field]: n } }); else setStrength({ ...strength, [field]: String(row.strength[field]) }); }} />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{i18n._({ id: "Between 0 and 2. The Create screen offers Less, Normal and More inside this range.", message: "Between 0 and 2. The Create screen offers Less, Normal and More inside this range." })}</p>
              </DialogSection>
              <DialogSection title={i18n._({ id: "Details", message: "Details" })}>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{i18n._({ id: "Source", message: "Source" })}</dt><dd className="min-w-0 break-words">{row.source.url ? <a className="underline" href={row.source.url} target="_blank" rel="noreferrer">{row.source.site}</a> : row.source.site === "file" ? i18n._({ id: "A file you added", message: "A file you added" }) : row.source.site}</dd>
                  <dt className="text-muted-foreground">{i18n._({ id: "Licence", message: "Licence" })}</dt><dd>{row.licence.id ?? i18n._({ id: "Not stated", message: "Not stated" })}{row.needs_confirmation ? i18n._({ id: ", not confirmed yet", message: ", not confirmed yet" }) : i18n._({ id: ", confirmed by an admin", message: ", confirmed by an admin" })}</dd>
                  <dt className="text-muted-foreground">{i18n._({ id: "Made for", message: "Made for" })}</dt><dd>{baseWords()[row.base_model]}</dd>
                  <dt className="text-muted-foreground">{i18n._({ id: "Size", message: "Size" })}</dt><dd>{sizeWords(row.file.bytes)}</dd>
                  <dt className="text-muted-foreground">{i18n._({ id: "Fingerprint", message: "Fingerprint" })}</dt><dd className="font-mono break-all text-sm">{row.file.sha256}</dd>
                </dl>
                {row.base_model === "unknown" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="se-base">{i18n._({ id: "What was this style made for?", message: "What was this style made for?" })}</Label>
                    <Select onValueChange={(v) => void save({ base_model: v as BaseModelId })}>
                      <SelectTrigger id="se-base"><SelectValue placeholder={i18n._({ id: "Pick one", message: "Pick one" })} /></SelectTrigger>
                      <SelectContent><SelectItem value="ltx-2.5">{i18n._({ id: "LTX-2.5", message: "LTX-2.5" })}</SelectItem><SelectItem value="wan2.2-ti2v-5b">{i18n._({ id: "Wan", message: "Wan" })}</SelectItem></SelectContent>
                    </Select>
                  </div>
                ) : null}
              </DialogSection>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <AlertDialog open={askRemove} onOpenChange={setAskRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Remove this style?", message: "Remove this style?" })}</AlertDialogTitle>
            <AlertDialogDescription>{i18n._({ id: "Its file moves to Recently removed for 30 days, then it is deleted. Clips already made with it stay.", message: "Its file moves to Recently removed for 30 days, then it is deleted. Clips already made with it stay." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Keep it", message: "Keep it" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void stylesApi.remove(row.id).then(() => { onChanged(); onClose(); }).catch((e: unknown) => setStatus({ ok: false, text: messageOf(e, i18n._({ id: "Home could not remove it. Try again.", message: "Home could not remove it. Try again." })) })); }}>{i18n._({ id: "Remove", message: "Remove" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={askLower} onOpenChange={setAskLower}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Make this style all ages?", message: "Make this style all ages?" })}</AlertDialogTitle>
            <AlertDialogDescription>{i18n._({ id: "Everyone who can use it will see its name and picture without a passcode. Clips already made with it stay locked until the person who made each one unlocks them for good. People under 18 still never see styles.", message: "Everyone who can use it will see its name and picture without a passcode. Clips already made with it stay locked until the person who made each one unlocks them for good. People under 18 still never see styles." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Keep adults only", message: "Keep adults only" })}</AlertDialogCancel>
            <AlertDialogAction onClick={lowerAdult}>{i18n._({ id: "Make all ages", message: "Make all ages" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fresh.dialog}
    </>
  );
}
