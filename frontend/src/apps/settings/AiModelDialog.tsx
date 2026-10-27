// AIMODELS-GLANCE-2026-10-26: the "Choose a model" dialog opened by a row's gear. Radio cards for the job's models plus Disable;
// Save choice only stages (the page holds the staging until Apply). Kit Elements as shipped (rule 9); the words are the spec's.
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { OFF, fill, type GlanceRow } from "@/apps/settings/aiGlanceRows";

export interface AiModelChoicesProps {
  row: GlanceRow;
  copy: Record<string, string>;
  onClose: () => void;
  onSave: (row: GlanceRow, pick: string) => void;
}

/** The dialog's content; the page renders the kit Dialog around it (rule 9: no Home wrapper around an Element). */
export function AiModelChoices({ row, copy, onClose, onSave }: AiModelChoicesProps) {
  const start = !row.shownEnabled ? OFF : row.shown?.id ?? OFF;
  const [pick, setPick] = useState(start);
  return (
    <>
      <DialogHeader>
        <p className="text-base font-medium uppercase tracking-wide text-muted-foreground">{row.title}</p>
        <DialogTitle>{copy.dialog_title}</DialogTitle>
        <DialogDescription>{copy.dialog_note}</DialogDescription>
      </DialogHeader>
      <RadioGroup value={pick} onValueChange={setPick} aria-label={copy.dialog_title}>
        {row.options.map((option) => {
          const id = `ai-dialog-${option.id}`;
          const blocked = option.blockedReason !== null && !option.current;
          return (
            <div key={option.id} data-testid={`ai-dialog-option-${option.id}`}>
              <FieldLabel htmlFor={id}>
                <Field orientation="horizontal" data-disabled={blocked ? "true" : undefined}>
                  <FieldContent>
                    <FieldTitle>
                      {option.label}
                      {option.recommended ? <Badge tone="success">{copy.recommended}</Badge> : null}
                      {option.id === "chat.uncensored" ? <Badge variant="outline" tone="warning">Uncensored</Badge> : null}
                    </FieldTitle>
                    <FieldDescription>{option.description}</FieldDescription>
                    <FieldDescription>
                      {sizeGb(option.installedBytes)} · {fill(copy.ram_estimate ?? "", { size: sizeGb(option.ramBytes) })}
                      {" · "}{option.blockedReason ?? copy.fits}
                    </FieldDescription>
                    <FieldDescription>{option.details.map((part) => `${part.name} (${sizeGb(part.sizeBytes)})`).join(", ")}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={option.id} id={id} disabled={blocked} />
                </Field>
              </FieldLabel>
            </div>
          );
        })}
        <FieldLabel htmlFor="ai-dialog-off">
          <Field orientation="horizontal">
            <FieldContent><FieldTitle>{fill(copy.disable_option ?? "", { name: row.title })}</FieldTitle></FieldContent>
            <RadioGroupItem value={OFF} id="ai-dialog-off" />
          </Field>
        </FieldLabel>
      </RadioGroup>
      <DialogFooter>
        {row.recommended ? <Button type="button" variant="link" onClick={() => setPick(row.recommended!.id)}>{copy.use_recommended}</Button> : null}
        <Button type="button" variant="outline" onClick={onClose}>{copy.cancel}</Button>
        <Button type="button" onClick={() => { onSave(row, pick); onClose(); }}>{copy.save_choice}</Button>
      </DialogFooter>
    </>
  );
}
