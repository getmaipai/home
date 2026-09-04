import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/kit/utils";

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  /** Maps an option's raw value to what's shown for it. Defaults to the
   * raw value itself (fine for household.locale's "en-US"/"en-GB", which
   * are already display strings); a code review (2026-09-04) found the
   * People page's role picker showing raw slugs ("owner", "child") this
   * way instead of the ROLE_LABELS the rest of that page already uses. */
  getLabel?: (value: string) => string;
  disabled?: boolean;
  "aria-label": string;
}

export function Select({ value, onValueChange, options, getLabel = (v) => v, disabled, ...rest }: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          "flex h-12 min-w-40 items-center justify-between gap-2 rounded-[var(--radius)] border",
          "border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-base",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        {...rest}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown className="h-4 w-4" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
          position="popper"
          sideOffset={4}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt}
                value={opt}
                className={cn(
                  "relative flex h-10 cursor-pointer items-center rounded-[calc(var(--radius)-0.25rem)] px-8 text-base",
                  "outline-none data-[highlighted]:bg-[hsl(var(--muted))]",
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <Check className="h-4 w-4" aria-hidden />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{getLabel(opt)}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
