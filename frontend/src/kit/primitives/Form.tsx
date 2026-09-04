import { useState, type FormEvent } from "react";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";

// The same `selector` vocabulary recipe.schema.json's inputs[] and
// spec/settings/keys.json use (docs/SETTINGS.md), so a form field and a
// settings key share one type language. Only "text" renders for real
// tonight (Chat's one field); the rest are typed so a future form
// (settings, another package) extends this file instead of inventing a
// second field-selector renderer, matching llm.ts's "typed, most
// unimplemented" posture.
export type FieldSelector =
  | "number"
  | "select"
  | "text"
  | "boolean"
  | "duration"
  | "time"
  | "entity"
  | "area"
  | "person"
  | "media";

export interface FormField {
  name: string;
  selector: FieldSelector;
  placeholder?: string;
}

interface FormProps {
  fields: FormField[];
  submitIcon?: string;
  submitLabel: string;
  disabled?: boolean;
  onSubmit: (values: Record<string, string>) => void;
}

export function Form({ fields, submitIcon, submitLabel, disabled, onSubmit }: FormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const SubmitIcon = submitIcon ? getIcon(submitIcon) : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]),
    );
    if (Object.values(trimmed).every((v) => v === "")) return;
    onSubmit(trimmed);
    setValues({});
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t border-[hsl(var(--border))] p-3">
      {fields.map((field) => {
        if (field.selector !== "text") {
          // Not built tonight; see the FieldSelector doc comment above.
          return null;
        }
        return (
          <Input
            key={field.name}
            placeholder={field.placeholder}
            value={values[field.name] ?? ""}
            disabled={disabled}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
            aria-label={field.placeholder ?? field.name}
          />
        );
      })}
      <Button type="submit" size="icon" disabled={disabled} aria-label={submitLabel}>
        {SubmitIcon ? <SubmitIcon className="h-5 w-5" aria-hidden /> : submitLabel}
      </Button>
    </form>
  );
}
