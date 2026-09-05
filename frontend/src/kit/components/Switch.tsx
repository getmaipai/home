import * as RadixSwitch from "@radix-ui/react-switch";
import { cn, FOCUS_RING } from "@/kit/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label": string;
}

export function Switch({ checked, onCheckedChange, disabled, ...rest }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        // The track stays 32px because that is what a switch should look
        // like; the TAP AREA is stretched to the kit's 48px minimum with
        // a transparent pseudo-element (docs/UI.md, WCAG 2.2 AA 2.5.5).
        // A code review (2026-09-05) caught the accessibility pass
        // raising the "Reset to default" link beside this to 48px and
        // leaving the control people actually tap at 32.
        "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
        "before:absolute before:inset-x-0 before:-top-2 before:-bottom-2 before:content-['']",
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]",
        FOCUS_RING,
      )}
      {...rest}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block h-6 w-6 translate-x-1 rounded-full bg-white transition-transform will-change-transform",
          checked && "translate-x-7",
        )}
      />
    </RadixSwitch.Root>
  );
}
