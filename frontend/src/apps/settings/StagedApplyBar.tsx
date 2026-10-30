// The one Apply bar for settings pages that stage choices first (AI and models, Offline data): pinned to the bottom of the
// screen, with any notices above the staged-changes card. A page passes its own words and what Apply does.
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";

export interface StagedApplyBarProps {
  /** Alerts shown above the card (a failed action, a refusal). */
  notices?: ReactNode;
  /** The card is shown only while something is staged. */
  staged: boolean;
  title: string;
  /** What will happen, in the page's words; shown under the title. */
  summary?: ReactNode;
  /** The step in progress while Apply runs. */
  step?: string | null;
  applying: boolean;
  applyDisabled?: boolean;
  applyLabel: string;
  discardLabel: string;
  onApply: () => void;
  onDiscard: () => void;
  testId: string;
  stagedTestId: string;
}

export function StagedApplyBar({ notices, staged, title, summary, step, applying, applyDisabled, applyLabel, discardLabel, onApply, onDiscard, testId, stagedTestId }: StagedApplyBarProps) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-2 bg-background pb-2" data-testid={testId}>
      {notices}
      {staged ? (
        <Alert data-testid={stagedTestId}>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            {summary}
            {applying && step ? <p className="text-base">{step}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={applying} onClick={onDiscard}>{discardLabel}</Button>
              <Button type="button" size="sm" disabled={applying || Boolean(applyDisabled)} onClick={onApply}>{applying ? "Applying…" : applyLabel}</Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
