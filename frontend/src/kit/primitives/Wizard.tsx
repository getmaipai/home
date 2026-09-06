import type { ReactNode } from "react";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { cn } from "@/kit/utils";

const CheckIcon = getIcon("check");

export interface WizardStep {
  id: string;
  title: string;
}

interface WizardProps {
  steps: WizardStep[];
  currentStepId: string;
  /** A step index at or below this has already been completed and can be
   * jumped back to from the task list; steps after it are locked (shown,
   * named, but not yet reachable) - platform plan 6.4's Wizard pattern:
   * "resume after reload," never "skip ahead of what you haven't done." */
  completedCount: number;
  onJumpTo: (id: string) => void;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  /** "Skip says what it means" (plan 6.4) - the caller supplies the real
   * reason (e.g. "Skip - set this up later in Settings"), never a bare
   * "Skip" that hides what's being given up. */
  skipLabel?: string;
  onSkip?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}

/** The kit's one wizard pattern (platform plan 6.4): "detect first, one
 * question per step, Continue, Back always works, Skip says what it
 * means, resume after reload... over seven steps, a task list" (not a
 * progress rail with a remaining-count, which the pattern reserves for
 * three-to-seven-step wizards - the setup wizard's own 9+ steps is
 * exactly the case a task list is for). Rendered as a horizontal strip
 * of numbered steps (never a two-pane sidebar layout): works identically
 * at phone width and desktop width with no separate responsive case,
 * unlike a sidebar that would need to collapse into something else on
 * phone. A completed step's number is clickable to jump back and change
 * an earlier answer; a step past the current one is named but not yet
 * reachable. */
export function Wizard({
  steps,
  currentStepId,
  completedCount,
  onJumpTo,
  children,
  onBack,
  onNext,
  skipLabel,
  onSkip,
  nextLabel = "Continue",
  nextDisabled,
  busy,
}: WizardProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);

  return (
    // `main`, not `div`: this renders shell-less (SignIn.tsx's own
    // precedent - "nothing in chapter 6 renders before someone is signed
    // in"), so there is no `SidebarInset` upstream already providing the
    // page's one `<main>` landmark the way every authenticated route
    // gets for free. Found live (2026-09-06) by the screenshot/a11y
    // matrix the moment `/setup` was added to its route list: axe's
    // `landmark-one-main`/`region` both failed, since nothing on this
    // page sat inside any landmark at all.
    <main className="flex h-full flex-col gap-6 p-6">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Setup steps">
        {steps.map((step, index) => {
          const isDone = index < completedCount;
          const isCurrent = step.id === currentStepId;
          const isReachable = isDone || isCurrent;
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? <span className="h-px w-4 bg-border" aria-hidden /> : null}
              <button
                type="button"
                onClick={() => isDone && !busy && onJumpTo(step.id)}
                disabled={!isDone || busy}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2 py-1 text-base",
                  isCurrent && "bg-primary/10 font-medium text-primary",
                  !isCurrent && isReachable && "text-foreground",
                  !isReachable && "text-muted-foreground",
                  isDone && "cursor-pointer hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-sm",
                    isDone && "border-primary bg-primary text-primary-foreground",
                    isCurrent && !isDone && "border-primary text-primary",
                    !isReachable && "border-border",
                  )}
                >
                  {isDone ? <CheckIcon className="h-3 w-3" aria-hidden /> : index + 1}
                </span>
                <span className="hidden sm:inline">{step.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h1 className="mb-4 text-2xl font-bold">{steps[currentIndex]?.title}</h1>
        {children}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
        ) : null}
        <div className="flex-1" />
        {onSkip ? (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={busy}>
            {skipLabel ?? "Skip"}
          </Button>
        ) : null}
        <Button type="button" onClick={onNext} disabled={busy || nextDisabled}>
          {busy ? "Working…" : nextLabel}
        </Button>
      </div>
    </main>
  );
}
