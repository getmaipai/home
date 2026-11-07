// TIER-HOME-04: the "Levels" dialog of one job on AI and models. Per level (Standard, Boost, Max and, for chat, Reduced): an on/off
// switch, the model, the options as plain switches and Who can use it. These per-category Boost and Max switches live only here (RULES.md S4).
// Kit Elements as shipped (rule 9); the page renders the kit Dialog around this content. A save writes the slot records at once; it does not
// join the page's staged Apply, because a level is a rule about who may use what, not a model to download.
import { i18n } from "@lingui/core";
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
import { MAX_RECOMMENDED_LABEL } from "../../../../shared/tierSlotOptions";
import { groupByFamily, familyNote, type PickGroup } from "@/apps/settings/aiTierSlots";
import { TIERED_JOBS, configurableTiers, consequences, isOn, optionDefs, whoChoices, withOn, type SlotDraft, type SlotDrafts, type SlotTier, type SlotWho } from "@/apps/settings/aiTierSlots";

const tierTitle = (tier: SlotTier): string => ({ standard: i18n._({ id: "Standard", message: "Standard" }), boost: i18n._({ id: "Boost", message: "Boost" }), max: i18n._({ id: "Max", message: "Max" }), reduced: i18n._({ id: "Let big jobs simplify chat", message: "Let big jobs simplify chat" }) } as Record<SlotTier, string>)[tier];
const tierPromise = (tier: SlotTier): string => ({
  standard: i18n._({ id: "Home keeps working normally while this runs. It is the floor, so it stays on.", message: "Home keeps working normally while this runs. It is the floor, so it stays on." }),
  boost: i18n._({ id: "Home stays up, but other big jobs wait their turn.", message: "Home stays up, but other big jobs wait their turn." }),
  max: i18n._({ id: "This takes the computer. Everything big waits.", message: "This takes the computer. Everything big waits." }),
  reduced: i18n._({ id: "When a Max job needs more room than is free, chat switches to a simpler model while it runs.", message: "When a Max job needs more room than is free, chat switches to a simpler model while it runs." }),
} as Record<SlotTier, string>)[tier];
const whoLabel = (who: SlotWho): string => ({ everyone: i18n._({ id: "Everyone the age gates allow", message: "Everyone the age gates allow" }), assigned: i18n._({ id: "Assigned people only", message: "Assigned people only" }), admins: i18n._({ id: "Admins only", message: "Admins only" }) } as Record<SlotWho, string>)[who];

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
  /** Show only this level (opened from the job summary); absent shows every level. */
  only?: SlotTier;
}

export function AiSlotChoices({ row, initial, picks, copy, saving, error, onClose, onSave, only }: AiSlotChoicesProps) {
  const [drafts, setDrafts] = useState<SlotDrafts>(initial);
  const spec = TIERED_JOBS[row.job]!;
  const defs = optionDefs(spec.category);
  const change = (tier: SlotTier, next: SlotDraft) => setDrafts((previous) => ({ ...previous, [tier]: next }));
  const level = (tier: SlotTier) => picks?.levels.find((candidate) => candidate.tier === tier) ?? null;
  const recommendedLabel = (tier: SlotTier) => {
    const id = level(tier)?.recommended;
    const named = id ? level(tier)?.candidates.find((candidate) => candidate.id === id)?.label : tier === "max" ? MAX_RECOMMENDED_LABEL[spec.category] : row.recommended?.label;
    return named ? i18n._({ id: "{named}. Follows catalog updates.", message: "{named}. Follows catalog updates.", values: { named } }) : i18n._({ id: "Follows catalog updates.", message: "Follows catalog updates." });
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
        <DialogTitle>{only ? tierTitle(only) : i18n._({ id: "Levels", message: "Levels" })}</DialogTitle>
        <DialogDescription>{i18n._({ id: "{value} Nothing is deleted or cancelled by turning a level off.", message: "{value} Nothing is deleted or cancelled by turning a level off.", values: { value: only ? tierPromise(only) : i18n._({ id: "Choose which levels exist, the model each one uses and who can use it.", message: "Choose which levels exist, the model each one uses and who can use it." }) } })}</DialogDescription>
      </DialogHeader>
      {configurableTiers(row.job).filter((tier) => !only || tier === only).map((tier) => {
        const draft = drafts[tier];
        const on = isOn(draft);
        const floor = tier === "standard";
        return (
          <section key={tier} data-testid={`ai-slot-${tier}`} className="flex flex-col gap-2" aria-label={tierTitle(tier)}>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>{tierTitle(tier)}</FieldTitle>
                <FieldDescription>{tierPromise(tier)}</FieldDescription>
              </FieldContent>
              <Switch checked={on} disabled={floor} aria-label={i18n._({ id: "{tier}: {state}", message: "{tier}: {state}", values: { tier: tierTitle(tier), state: on ? (copy.on ?? i18n._({ id: "On", message: "On" })) : (copy.off ?? i18n._({ id: "Off", message: "Off" })) } })} onCheckedChange={(next) => change(tier, withOn(draft, next))} />
            </Field>
            {on && tier !== "reduced" ? (
              <>
                <RadioGroup value={draft.model} onValueChange={(model) => change(tier, { ...draft, model })} aria-label={i18n._({ id: "{tier} model", message: "{tier} model", values: { tier: tierTitle(tier) } })}>
                  <FieldLabel htmlFor={`ai-slot-${tier}-recommended`}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>{copy.use_recommended ?? i18n._({ id: "Use the recommended model", message: "Use the recommended model" })}</FieldTitle>
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
                {picks && groupsFor(tier).some((group) => group.heading) ? <p className="text-base text-muted-foreground">{familyNote()}</p> : null}
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
                  <p className="text-base font-medium">{i18n._({ id: "Who can use it", message: "Who can use it" })}</p>
                  <RadioGroup value={draft.who} onValueChange={(who) => change(tier, { ...draft, who: who as SlotWho })} aria-label={i18n._({ id: "Who can use {tier}", message: "Who can use {tier}", values: { tier: tierTitle(tier) } })}>
                    {whoChoices(tier).map((who) => (
                      <FieldLabel key={who} htmlFor={`ai-slot-${tier}-who-${who}`}>
                        <Field orientation="horizontal">
                          <FieldContent><FieldTitle>{whoLabel(who)}</FieldTitle></FieldContent>
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
        <Button type="button" variant="outline" onClick={onClose}>{only ? i18n._({ id: "Back", message: "Back" }) : (copy.cancel ?? i18n._({ id: "Cancel", message: "Cancel" }))}</Button>
        <Button type="button" disabled={saving} onClick={() => onSave(drafts)}>{saving ? i18n._({ id: "Saving…", message: "Saving…" }) : (copy.save_choice ?? i18n._({ id: "Save", message: "Save" }))}</Button>
      </DialogFooter>
    </>
  );
}
