// AIMODELS-CHOICES-01: one job on the AI and models page (Chat, Pictures, Videos, Music, Voice, Coding, Search and memory).
// The same shape for every job, so the page reads like Pictures does: a title and one sentence, the current choice marked
// twice (the filled radio or the switch, and the chip), one Recommended mark, plain size and state words, one action per
// choice that is not ready, and model names only under Details. Shared kit Elements only (rule 9): no frame, Card or wrapper
// of its own; the page that holds the seven jobs draws them. The words come from shared/aiChoices.ts.
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { AiCard, AiChoice } from "../../../../shared/aiChoices";

export interface AiJobChoicesProps {
  card: AiCard;
  /** Presses a choice: install it and make it the choice ("get"), make it the choice ("use"), or take a switch off ("remove"). */
  onAct: (choice: AiChoice) => void | Promise<void>;
  /** The id of the choice whose action is running now, so its button waits. */
  busyId?: string | null;
}

const isRadioRow = (choice: AiChoice): boolean => choice.kind === "radio" || (choice.kind === "fixed" && choice.id === "voice.standard");

function actionLabel(choice: AiChoice): string | null {
  if (choice.action === "get") return choice.kind === "radio" ? `Get and use ${choice.label}` : `Get ${choice.label}`;
  if (choice.action === "use") return choice.setting === null && choice.kind === "radio" ? null : "Use this";
  return null;
}

function RadioChoice({ choice, onAct, busy }: { choice: AiChoice; onAct: AiJobChoicesProps["onAct"]; busy: boolean }) {
  const label = actionLabel(choice);
  const disabled = choice.blockedReason !== null && !choice.current;
  const inputId = `ai-choice-${choice.id}`;
  return (
    <div data-testid={`ai-choice-${choice.id}`} data-current={choice.current ? "true" : "false"}>
      <FieldLabel htmlFor={inputId}>
        <Field orientation="horizontal" data-disabled={disabled ? "true" : undefined}>
          <FieldContent>
            <FieldTitle>
              {choice.label}
              {choice.recommended ? <Badge variant="outline">Recommended</Badge> : null}
            </FieldTitle>
            <FieldDescription>{choice.description}</FieldDescription>
            <FieldDescription>{choice.stateText}{choice.blockedReason ? ` ${choice.blockedReason}` : ""}</FieldDescription>
            {choice.state === "installing" ? <Progress value={choice.percent ?? 0} aria-label={`Getting ${choice.name}`} /> : null}
          </FieldContent>
          <RadioGroupItem value={choice.id} id={inputId} disabled={disabled} />
        </Field>
      </FieldLabel>
      {label ? <Button type="button" height="auto" wrap="wrap" onClick={() => void onAct(choice)} disabled={busy || choice.state === "installing"}>{busy ? "Working…" : label}</Button> : null}
      {choice.state === "failed" ? <Button type="button" variant="outline" onClick={() => void onAct(choice)} disabled={busy}>Try again</Button> : null}
    </div>
  );
}

function SwitchRow({ choice, onAct, busy }: { choice: AiChoice; onAct: AiJobChoicesProps["onAct"]; busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const switchId = `ai-switch-${choice.id}`;
  // On: take it out. Off: get it, or just turn it on when it is already here.
  const canToggle = !busy && choice.state !== "installing" && (choice.current ? choice.action === "remove" : choice.action === "get" || choice.action === "use");
  const onChange = (next: boolean) => {
    if (!next && choice.current) setConfirm(true);
    else if (next) void onAct(choice);
  };
  return (
    <>
      <Item data-testid={`ai-choice-${choice.id}`} data-current={choice.current ? "true" : "false"}>
        <ItemContent>
          <ItemTitle>
            <label htmlFor={switchId}>{choice.label}</label>
            {choice.recommended ? <Badge variant="outline">Recommended</Badge> : null}
          </ItemTitle>
          <ItemDescription clamp={false}>{choice.description}</ItemDescription>
          <ItemDescription clamp={false}>{choice.stateText}{choice.blockedReason ? ` ${choice.blockedReason}` : ""}</ItemDescription>
          {choice.state === "installing" ? <Progress value={choice.percent ?? 0} aria-label={`Getting ${choice.name}`} /> : null}
        </ItemContent>
        <ItemActions>
          <Switch id={switchId} checked={choice.current} onCheckedChange={onChange} disabled={!canToggle} aria-label={choice.label} />
          {choice.state === "failed" ? <Button type="button" variant="outline" onClick={() => void onAct(choice)} disabled={busy}>Try again</Button> : null}
        </ItemActions>
      </Item>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off {choice.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {choice.setting !== null
                ? "It stays on this computer. You can turn it on again at any time."
                : `This frees about ${sizeGb(choice.installedBytes)}. You can get it back later. It is a download of the same size.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it on</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); void onAct(choice); }}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AiJobChoices({ card, onAct, busyId = null }: AiJobChoicesProps) {
  const radios = card.choices.filter(isRadioRow);
  const current = radios.find((choice) => choice.current)?.id ?? "";
  const others = card.choices.filter((choice) => !isRadioRow(choice));
  const notReady = card.choices.filter((choice) => choice.chosenNotReady);
  const seen = new Set<string>();
  const detailRows = card.choices.flatMap((choice) => choice.details.map((detail) => ({ choice, ...detail }))).filter((row) => (seen.has(row.name) ? false : (seen.add(row.name), true)));
  return (
    <section aria-label={card.title} data-testid={`ai-card-${card.id}`} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">{card.title}</h3>
        <Badge variant="secondary" data-testid={`ai-chip-${card.id}`}>{card.chip}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{card.summary}</p>
      {card.unavailable ? <p className="text-sm text-muted-foreground">{card.unavailable}</p> : null}
      {notReady.map((choice) => (
        <Alert key={choice.id}>
          <AlertTitle>{choice.name} is chosen, but it is not ready</AlertTitle>
          <AlertDescription>Home uses the other choice until it is on this computer.</AlertDescription>
        </Alert>
      ))}
      {radios.length > 0 ? (
        <RadioGroup value={current} onValueChange={(value) => { const picked = radios.find((choice) => choice.id === value); if (picked && picked.action === "use" && picked.setting !== null) void onAct(picked); }} aria-label={`${card.title} choices`}>
          {radios.map((choice) => <RadioChoice key={choice.id} choice={choice} onAct={onAct} busy={busyId === choice.id} />)}
        </RadioGroup>
      ) : null}
      {others.length > 0 ? (
        <ItemGroup variant="card" aria-label={`${card.title} options`}>
          {others.map((choice) => (choice.kind === "switch"
            ? <SwitchRow key={choice.id} choice={choice} onAct={onAct} busy={busyId === choice.id} />
            : (
              <Item key={choice.id} data-testid={`ai-choice-${choice.id}`}>
                <ItemContent>
                  <ItemTitle>{choice.label}</ItemTitle>
                  <ItemDescription clamp={false}>{choice.description}</ItemDescription>
                  <ItemDescription clamp={false}>{choice.state === "installed" ? "Installed, always on" : choice.stateText}</ItemDescription>
                  {choice.state === "installing" ? <Progress value={choice.percent ?? 0} aria-label={`Getting ${choice.name}`} /> : null}
                </ItemContent>
              </Item>
            )))}
        </ItemGroup>
      ) : null}
      {detailRows.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild><Button type="button" variant="link">Details</Button></CollapsibleTrigger>
          <CollapsibleContent>
            <ItemGroup variant="card" aria-label={`${card.title} parts`}>
              {detailRows.map((row) => (
                <Item key={row.name}>
                  <ItemContent>
                    <ItemTitle>{row.name}</ItemTitle>
                    <ItemDescription clamp={false}>{sizeGb(row.sizeBytes)} on disk. Used by: {row.choice.name}.</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
