// VIDEO-LORA-08 (settings-media 5.5): the style editor, a kit Dialog (flow) so an unlocked page is never left. About, Try this style and Remove, Who can use it
// (and the Adults only switch), Added to the prompt, Avoid with Say instead, Strength, Details. Every change saves at once and says so. Turning Adults only on
// is free; turning it off asks, and asks for the passcode again when the source said adult (design 15.1).
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
import { BASE_WORDS, stylesApi, type BaseModelId, type StylePatch, type StyleRow, type StyleWho } from "@/apps/settings/styles/stylesApi";
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

  async function save(patch: StylePatch, what = "Saved.") {
    setStatus(null);
    try { await stylesApi.patch(row.id, patch); setStatus({ ok: true, text: what }); onChanged(); }
    catch (e) { setStatus({ ok: false, text: messageOf(e, "Home could not save that. Check the Home connection, then try again.") }); }
  }
  async function act(run: () => Promise<unknown>, done: string, fallback: string) {
    setStatus(null);
    try { await run(); setStatus({ ok: true, text: done }); onChanged(); }
    catch (e) { setStatus({ ok: false, text: messageOf(e, fallback) }); }
  }
  const who = row.availability.who;
  const setWho = (next: StyleWho) => {
    if (next === "people" && people.length === 0) { void save({ availability: { who: "people", people: [] } }, "Saved. Choose who below."); return; }
    void save({ availability: { who: next, people: next === "people" ? people : [] } });
  };
  const fresh = useFreshConfirm({
    person, item: row.id, title: "Make this style all ages?", description: "The source marked this style adult. Enter your passcode again to make it all ages.",
    actionLabel: "Make all ages", run: async (ticket) => { await stylesApi.markAllAges(row.id, ticket); setStatus({ ok: true, text: "Now all ages." }); onChanged(); },
    onFailed: (e) => setStatus({ ok: false, text: messageOf(e, "Home could not change that. Try again.") }),
  });
  const lowerAdult = () => { if (row.adult_check === "adult") fresh.ask(); else void act(() => stylesApi.markAllAges(row.id), "Now all ages.", "Home could not change that. Try again."); };

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent variant="flow" size="xl" aria-describedby="style-editor-desc" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle size="xl">{row.name}</DialogTitle>
            <DialogDescription id="style-editor-desc">Changes save as you make them.</DialogDescription>
          </DialogHeader>
          <div role="status" aria-live="polite" className={status && !status.ok ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{status?.text ?? ""}</div>
          <DialogBody columns="two">
            <div className="flex flex-col gap-6">
              <DialogSection title="About">
                <div className="aspect-video w-full max-w-sm overflow-hidden rounded-xl bg-muted"><StylePicture path={filePath(row.preview_file_id)} proof={row.audience === "adult-only"} /></div>
                <div className="flex flex-col gap-2"><Label htmlFor="se-name">Name</Label><Input id="se-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { const t = name.trim(); if (t && t !== row.name) void save({ name: t }); }} /></div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="se-desc">What it does</Label>
                  <Input id="se-desc" value={description} maxLength={140} onChange={(e) => setDescription(e.target.value)} onBlur={() => { if (description.trim() !== row.description) void save({ description: description.trim() }); }} />
                  <p className="text-sm text-muted-foreground">{description.length} of 140 characters</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="se-kind">Kind</Label>
                  <Select value={row.kind} onValueChange={(v) => void save({ kind: v as StyleRow["kind"] })}>
                    <SelectTrigger id="se-kind"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="style">Style</SelectItem><SelectItem value="character">Character</SelectItem><SelectItem value="motion">Motion</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={!row.usable} onClick={() => navigate("/apps/videos/create", { state: tryStyleState(row) })}>Try this style</Button>
                  <Button type="button" variant="outline" onClick={() => setAskRemove(true)}>Remove</Button>
                </div>
              </DialogSection>
              <DialogSection title="Who can use it">
                {row.needs_confirmation ? (
                  <Alert><AlertDescription><span className="flex flex-col items-start gap-2">Read the licence and fingerprint under Details, then confirm them. Until you do, only admins can use this style.<Button type="button" size="sm" variant="outline" onClick={() => void act(() => stylesApi.confirmLicence(row.id), "Confirmed.", "Home could not confirm that. Try again.")}>I have read them</Button></span></AlertDescription></Alert>
                ) : null}
                <RadioGroup value={who} onValueChange={(v) => setWho(v as StyleWho)} aria-label="Who can use this style">
                  {([["admins", "Only admins"], ["adults", "All adults"], ["people", "Chosen people"]] as const).map(([v, text]) => (
                    <div key={v} className="flex items-center gap-2"><RadioGroupItem value={v} id={`se-who-${v}`} disabled={v !== "admins" && row.needs_confirmation} /><Label htmlFor={`se-who-${v}`}>{text}</Label></div>
                  ))}
                </RadioGroup>
                {who === "people" ? (
                  <PersonMultiSelect ariaLabel="Chosen people" people={adults} value={people} onValueChange={(ids) => { setPeople(ids); void save({ availability: { who: "people", people: ids } }); }} />
                ) : null}
                <div className="flex items-center gap-3">
                  <Switch id="se-adult" checked={row.audience === "adult-only"} aria-label="Adults only"
                    onCheckedChange={(on) => { if (on) void act(() => stylesApi.markAdultOnly(row.id), "Now adults only.", "Home could not change that. Try again."); else setAskLower(true); }} />
                  <Label htmlFor="se-adult">Adults only</Label>
                </div>
                <p className="text-sm text-muted-foreground">{adultCheckLine(row.adult_check)} People under 18 never see styles.</p>
              </DialogSection>
            </div>
            <div className="flex flex-col gap-6">
              <DialogSection title="Added to the prompt">
                <PhraseListField label="Words that switch it on" help="Home adds these to the person's words when they pick this style." value={row.trigger_words} addLabel="Add a word" maxItems={12} maxItemChars={80} onChange={(v) => void save({ trigger_words: v })} />
                <PhraseListField label="Also add" help="Phrases added to the person's words, never replacing them." value={row.positive_addins} addLabel="Add a phrase" maxItems={8} maxItemChars={120} maxTotalChars={400} onChange={(v) => void save({ positive_addins: v })} />
                <Collapsible>
                  <CollapsibleTrigger asChild><Button type="button" variant="link">More</Button></CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col gap-2 pt-2"><Label htmlFor="se-pos">Where the words go</Label>
                    <Select value={row.trigger_position} onValueChange={(v) => void save({ trigger_position: v as "start" | "end" })}>
                      <SelectTrigger id="se-pos"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="start">At the start</SelectItem><SelectItem value="end">At the end</SelectItem></SelectContent>
                    </Select></div>
                  </CollapsibleContent>
                </Collapsible>
              </DialogSection>
              <DialogSection title="Avoid">
                <PhrasePairsField label="Avoid, and say this instead" help="Videos at Standard and Boost cannot use avoid words. Say the opposite instead." value={pairsOf(row)} firstLabel="Avoid" secondLabel="Say instead" addLabel="Add a pair" maxItems={8} maxItemChars={120} maxTotalChars={400}
                  onChange={(v) => void save({ negative_addins: v.map((p) => p.avoid), avoid_as_positive: v.map((p) => p.say) })} />
              </DialogSection>
              <DialogSection title="Strength">
                <div className="grid grid-cols-3 gap-3">
                  {(["default", "min", "max"] as const).map((field) => (
                    <div key={field} className="flex flex-col gap-1.5">
                      <Label htmlFor={`se-str-${field}`}>{field === "default" ? "Normal" : field === "min" ? "Lowest" : "Highest"}</Label>
                      <Input id={`se-str-${field}`} inputMode="decimal" value={strength[field]} onChange={(e) => setStrength({ ...strength, [field]: e.target.value })}
                        onBlur={() => { const n = Number(strength[field]); if (Number.isFinite(n) && n >= 0 && n <= 2 && n !== row.strength[field]) void save({ strength: { [field]: n } }); else setStrength({ ...strength, [field]: String(row.strength[field]) }); }} />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Between 0 and 2. The Create screen offers Less, Normal and More inside this range.</p>
              </DialogSection>
              <DialogSection title="Details">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Source</dt><dd className="min-w-0 break-words">{row.source.url ? <a className="underline" href={row.source.url} target="_blank" rel="noreferrer">{row.source.site}</a> : row.source.site === "file" ? "A file you added" : row.source.site}</dd>
                  <dt className="text-muted-foreground">Licence</dt><dd>{row.licence.id ?? "Not stated"}{row.needs_confirmation ? ", not confirmed yet" : ", confirmed by an admin"}</dd>
                  <dt className="text-muted-foreground">Made for</dt><dd>{BASE_WORDS[row.base_model]}</dd>
                  <dt className="text-muted-foreground">Size</dt><dd>{sizeWords(row.file.bytes)}</dd>
                  <dt className="text-muted-foreground">Fingerprint</dt><dd className="font-mono break-all text-sm">{row.file.sha256}</dd>
                </dl>
                {row.base_model === "unknown" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="se-base">What was this style made for?</Label>
                    <Select onValueChange={(v) => void save({ base_model: v as BaseModelId })}>
                      <SelectTrigger id="se-base"><SelectValue placeholder="Pick one" /></SelectTrigger>
                      <SelectContent><SelectItem value="ltx-2.5">LTX-2.5</SelectItem><SelectItem value="ltx-2.3">LTX-2.3</SelectItem></SelectContent>
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
            <AlertDialogTitle>Remove this style?</AlertDialogTitle>
            <AlertDialogDescription>Its file moves to Recently removed for 30 days, then it is deleted. Clips already made with it stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void stylesApi.remove(row.id).then(() => { onChanged(); onClose(); }).catch((e: unknown) => setStatus({ ok: false, text: messageOf(e, "Home could not remove it. Try again.") })); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={askLower} onOpenChange={setAskLower}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this style all ages?</AlertDialogTitle>
            <AlertDialogDescription>Everyone who can use it will see its name and picture without a passcode. Clips already made with it stay locked until the person who made each one unlocks them for good. People under 18 still never see styles.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep adults only</AlertDialogCancel>
            <AlertDialogAction onClick={lowerAdult}>Make all ages</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fresh.dialog}
    </>
  );
}
