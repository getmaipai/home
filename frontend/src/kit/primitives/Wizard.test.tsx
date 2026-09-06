import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Wizard, type WizardStep } from "@/kit/primitives/Wizard";

afterEach(cleanup);

const STEPS: WizardStep[] = [
  { id: "a", title: "Household" },
  { id: "b", title: "Owner" },
  { id: "c", title: "Done" },
];

describe("Wizard", () => {
  test("shows the current step's title as the heading", () => {
    const { getByRole } = render(
      <Wizard steps={STEPS} currentStepId="b" completedCount={1} onJumpTo={() => {}} onNext={() => {}}>
        content
      </Wizard>,
    );
    expect(getByRole("heading", { name: "Owner" })).toBeTruthy();
  });

  test("Continue calls onNext", () => {
    const onNext = mock(() => {});
    const { getByRole } = render(
      <Wizard steps={STEPS} currentStepId="a" completedCount={0} onJumpTo={() => {}} onNext={onNext}>
        content
      </Wizard>,
    );
    fireEvent.click(getByRole("button", { name: "Continue" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test("no Back button on the first step; Back appears and fires once onBack is supplied", () => {
    const onBack = mock(() => {});
    const { queryByRole, rerender, getByRole } = render(
      <Wizard steps={STEPS} currentStepId="a" completedCount={0} onJumpTo={() => {}} onNext={() => {}}>
        content
      </Wizard>,
    );
    expect(queryByRole("button", { name: "Back" })).toBeNull();

    rerender(
      <Wizard steps={STEPS} currentStepId="b" completedCount={1} onJumpTo={() => {}} onNext={() => {}} onBack={onBack}>
        content
      </Wizard>,
    );
    fireEvent.click(getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("a completed step's number is clickable and jumps back to it", () => {
    const onJumpTo = mock(() => {});
    const { getByRole } = render(
      <Wizard steps={STEPS} currentStepId="c" completedCount={2} onJumpTo={onJumpTo} onNext={() => {}}>
        content
      </Wizard>,
    );
    fireEvent.click(getByRole("button", { name: /Household/ }));
    expect(onJumpTo).toHaveBeenCalledWith("a");
  });

  test("a not-yet-reached step is named but its button is disabled, not jumpable", () => {
    const onJumpTo = mock(() => {});
    const { getByRole } = render(
      <Wizard steps={STEPS} currentStepId="a" completedCount={0} onJumpTo={onJumpTo} onNext={() => {}}>
        content
      </Wizard>,
    );
    const futureStep = getByRole("button", { name: /Done/ });
    expect(futureStep.hasAttribute("disabled")).toBe(true);
    fireEvent.click(futureStep);
    expect(onJumpTo).not.toHaveBeenCalled();
  });

  test("Skip renders the caller's own reason, never a bare label, and fires onSkip", () => {
    const onSkip = mock(() => {});
    const { getByRole } = render(
      <Wizard
        steps={STEPS}
        currentStepId="a"
        completedCount={0}
        onJumpTo={() => {}}
        onNext={() => {}}
        onSkip={onSkip}
        skipLabel="Skip - set this up later in Settings"
      >
        content
      </Wizard>,
    );
    fireEvent.click(getByRole("button", { name: "Skip - set this up later in Settings" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  test("nextDisabled and busy both disable Continue; busy relabels it", () => {
    const { getByRole, rerender } = render(
      <Wizard steps={STEPS} currentStepId="a" completedCount={0} onJumpTo={() => {}} onNext={() => {}} nextDisabled>
        content
      </Wizard>,
    );
    expect(getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);

    rerender(
      <Wizard steps={STEPS} currentStepId="a" completedCount={0} onJumpTo={() => {}} onNext={() => {}} busy>
        content
      </Wizard>,
    );
    expect(getByRole("button", { name: "Working…" }).hasAttribute("disabled")).toBe(true);
  });
});
