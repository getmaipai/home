// TIER-HOME-04: the "Levels" dialog of one job on AI and models. Per level (Standard, Boost, Max and, for chat, Reduced): an on/off
// switch, the model, the options as plain switches and Who can use it. These per-category Boost and Max switches live only here (RULES.md S4).
// Kit Elements as shipped (rule 9); the page renders the kit Dialog around this content. A save writes the slot records at once; it does not
// join the page's staged Apply, because a level is a rule about who may use what, not a model to download.
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Input } from "@maipai/ui/src/ui/input";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import type { GlanceRow } from "@/apps/settings/aiGlanceRows";
import type { TierPicks } from "@/lib/aiChoicesApi";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { groupByFamily, FAMILY_NOTE, type PickGroup } from "@/apps/settings/aiTierSlots";
import { TIERED_JOBS, configurableTiers, consequences, isOn, optionDefs, whoChoices, withOn, type SlotDraft, type SlotDrafts, type SlotTier, type SlotWho } from "@/apps/settings/aiTierSlots";

const TIER_TITLE: Record<SlotTier, string> = { standard: "Standard", boost: "Boost", max: "Max", reduced: "Let big jobs simplify chat" };
const TIER_PROMISE: Record<SlotTier, string> = {
  standard: "Home keeps working normally while this runs. It is the floor, so it stays on.",
  boost: "Home stays up, but other big jobs wait their turn.",
  max: "This takes the computer. Everything big waits.",
  reduced: "While a Max job runs, chat switches to a simpler model so the job can have more of the computer.",
};
const WHO_LABEL: Record<SlotWho, string> = { everyone: "Everyone the age gates allow", assigned: "Assigned people only", admins: "Admins only" };

export interface AiSlotChoicesProps {
  row: GlanceRow;
  initial: SlotDrafts;
  /** The Stack's candidates per level (families, what fits each cap). Null while it loads or when the engine cannot say: the dialog then shows the job's own choices. */
  picks: TierPicks | null;
  copy: Record<string, string>;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (drafts: SlotDrafts) => void;
}

export function AiSlotChoices({ row, initial, picks, copy, saving, error, onClose, onSave }: AiSlotChoicesProps) {
  const [drafts, setDrafts] = useState<SlotDrafts>(initial);
  const spec = TIERED_JOBS[row.job]!;
  const defs = optionDefs(spec.category);
  const change = (tier: SlotTier, next: SlotDraft) => setDrafts((previous) => ({ ...previous, [tier]: next }));
  const level = (tier: SlotTier) => picks?.levels.find((candidate) => candidate.tier === tier) ?? null;
  const recommendedLabel = (tier: SlotTier) => {
    const id = level(tier)?.recommended;
    const named = id ? level(tier)?.candidates.find((candidate) => candidate.id === id)?.label : row.recommended?.label;
    return `${named ? `${named}. ` : ""}Follows catalog updates.`;
  };
  const groupsFor = (tier: SlotTier): PickGroup[] => {
    const found = level(tier);
    if (found) return groupByFamily(found.candidates, (bytes) => sizeGb(bytes));
    return [{ family: "all", heading: null, options: row.options.map((option) => ({ id: option.id, label: option.label, description: option.description, blockedReason: option.blockedReason })) }];
  };
  const notes = consequences(drafts, row.job, row.title);
  return (
    <>
      <DialogHeader>
        <p className="text-base font-medium uppercase tracking-wide text-muted-foreground">{row.title}</p>
        <DialogTitle>Levels</DialogTitle>
        <DialogDescription>Choose which levels exist, the model each one uses and who can use it. Nothing is deleted or cancelled by turning a level off.</DialogDescription>
      </DialogHeader>
      {configurableTiers(row.job).map((tier) => {
        const draft = drafts[tier];
        const on = isOn(draft);
        const floor = tier === "standard";
        return (
          <section key={tier} data-testid={`ai-slot-${tier}`} className="flex flex-col gap-2" aria-label={TIER_TITLE[tier]}>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>{TIER_TITLE[tier]}</FieldTitle>
                <FieldDescription>{TIER_PROMISE[tier]}</FieldDescription>
              </FieldContent>
              <Switch checked={on} disabled={floor} aria-label={`${TIER_TITLE[tier]}: ${on ? (copy.on ?? "On") : (copy.off ?? "Off")}`} onCheckedChange={(next) => change(tier, withOn(draft, next))} />
            </Field>
            {on && tier !== "reduced" ? (
              <>
                <RadioGroup value={draft.model} onValueChange={(model) => change(tier, { ...draft, model })} aria-label={`${TIER_TITLE[tier]} model`}>
                  <FieldLabel htmlFor={`ai-slot-${tier}-recommended`}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>{copy.use_recommended ?? "Use the recommended model"}</FieldTitle>
                        <FieldDescription>{recommendedLabel(tier)}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value="recommended" id={`ai-slot-${tier}-recommended`} />
                    </Field>
                  </FieldLabel>
                  {groupsFor(tier).map((group) => (
                    <div key={group.family} role="group" aria-label={group.family} data-testid={`ai-slot-${tier}-family-${group.family}`} className="flex flex-col gap-2">
                      {group.heading ? <p className="text-base font-medium uppercase tracking-wide text-muted-foreground">{group.heading}</p> : null}
                      {group.options.map((option) => {
                        const id = `ai-slot-${tier}-${option.id}`;
                        const blocked = option.blockedReason !== null && draft.model !== option.id;
                        return (
                          <FieldLabel key={option.id} htmlFor={id}>
                            <Field orientation="horizontal" data-disabled={blocked ? "true" : undefined}>
                              <FieldContent>
                                <FieldTitle>{option.label}</FieldTitle>
                                <FieldDescription>{option.blockedReason ?? option.description}</FieldDescription>
                              </FieldContent>
                              <RadioGroupItem value={option.id} id={id} disabled={blocked} />
                            </Field>
                          </FieldLabel>
                        );
                      })}
                    </div>
                  ))}
                </RadioGroup>
                {picks && groupsFor(tier).some((group) => group.heading) ? <p className="text-base text-muted-foreground">{FAMILY_NOTE}</p> : null}
                {defs.map((def) => {
                  const id = `ai-slot-${tier}-opt-${def.id}`;
                  const value = draft.options[def.id] ?? def.default;
                  const set = (next: boolean | number) => change(tier, { ...draft, options: { ...draft.options, [def.id]: next } });
                  return (
                    <Field key={def.id} orientation="horizontal">
                      <FieldContent><FieldLabel htmlFor={id}>{def.label}</FieldLabel></FieldContent>
                      {def.type === "boolean"
                        ? <Switch id={id} checked={value === true} aria-label={def.label} onCheckedChange={set} />
                        : <Input id={id} type="number" inputMode="numeric" min={def.min} max={def.max} value={String(value)} onChange={(event) => { const n = Number(event.target.value); if (Number.isFinite(n)) set(n); }} />}
                    </Field>
                  );
                })}
                {whoChoices(tier).length > 1 ? (
                  <>
                  <p className="text-base font-medium">Who can use it</p>
                  <RadioGroup value={draft.who} onValueChange={(who) => change(tier, { ...draft, who: who as SlotWho })} aria-label={`Who can use ${TIER_TITLE[tier]}`}>
                    {whoChoices(tier).map((who) => (
                      <FieldLabel key={who} htmlFor={`ai-slot-${tier}-who-${who}`}>
                        <Field orientation="horizontal">
                          <FieldContent><FieldTitle>{WHO_LABEL[who]}</FieldTitle></FieldContent>
                          <RadioGroupItem value={who} id={`ai-slot-${tier}-who-${who}`} />
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                  </>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}
      {notes.length > 0 ? <Alert data-testid="ai-slot-consequences"><AlertDescription>{notes.map((line) => <p key={line}>{line}</p>)}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{copy.cancel ?? "Cancel"}</Button>
        <Button type="button" disabled={saving} onClick={() => onSave(drafts)}>{saving ? "Saving…" : (copy.save_choice ?? "Save")}</Button>
      </DialogFooter>
    </>
  );
}
