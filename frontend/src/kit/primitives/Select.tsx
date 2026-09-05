import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit/ui/select";

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

// A pattern component over `kit/ui/select.tsx`'s compound API, not that
// API used directly: most callers here (a settings key's fixed choices, a
// role picker) have nothing but a flat list of strings, and re-deriving
// the same `options.map(...)` at every call site would be the copy this
// primitive exists to avoid (org standard 1). A page that needs a real
// grouped or richly-labelled menu still reaches for the compound pieces
// directly rather than stretching this wrapper to fit.
export function Select({
  value,
  onValueChange,
  options,
  getLabel = (v) => v,
  disabled,
  ...rest
}: SelectProps) {
  return (
    <SelectRoot value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="min-w-40" {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {getLabel(opt)}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
