import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "@/kit/utils";

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
        "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
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
