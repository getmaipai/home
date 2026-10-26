// FORM-CHAT-HUB-01: the hub half of a typed package ask (docs/design/form-in-chat-2026-10-25.md).
// One place for the form's lifetime and for checking submitted values against the fields the
// package declared. Submitted values are request-local: nothing here logs, traces or stores them
// (RULES.md rule 6a), and error messages name only the package-declared field label.
import type { TurnAskField } from "@/wire";

/** How long a drawn form accepts a Submit. */
export const ASK_FORM_TTL_MS = 15 * 60_000;

/** The user-turn line stored for a form submission. Fixed wording: what the person typed is never copied into the turn. */
export const ASK_SUBMITTED_LINE = "I filled in the form.";

/** The call id prefix of a package re-run after a form Submit; the tool node and policy node key off it. */
export const RESUMED_ASK_CALL_PREFIX = "resumed-ask:";

export type AskValues = Record<string, string | number | boolean | null>;

export type AskValuesCheck = { ok: true; inputs: Record<string, string | number | boolean> } | { ok: false; error: string };

function fieldError(field: TurnAskField, problem: string): AskValuesCheck {
  return { ok: false, error: `${problem} for "${field.label}". Correct that field and submit the form again.` };
}

/** Checks every submitted value against its field (kind, required, max_length, min, max, choice membership, yes_no boolean).
 * An unknown name is refused. Optional fields left empty are left out of the returned inputs. */
export function validateAskValues(fields: TurnAskField[], values: AskValues): AskValuesCheck {
  const known = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) return { ok: false, error: "The form had a field this request does not recognize. Reopen the request and submit the form again." };
  }
  const inputs: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === null || value === "") {
      if (field.required) return fieldError(field, "A value is needed");
      continue;
    }
    switch (field.kind) {
      case "text":
        if (typeof value !== "string") return fieldError(field, "Text is needed");
        if ([...value].length > (field.max_length ?? 500)) return fieldError(field, `Text is too long (at most ${field.max_length ?? 500} characters)`);
        break;
      case "date_time":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fieldError(field, "A date and time is needed");
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) return fieldError(field, "A number is needed");
        if (field.min !== undefined && value < field.min) return fieldError(field, `The number is too small (at least ${field.min})`);
        if (field.max !== undefined && value > field.max) return fieldError(field, `The number is too large (at most ${field.max})`);
        break;
      case "choice":
        if (typeof value !== "string" || !field.options?.includes(value)) return fieldError(field, "One of the listed choices is needed");
        break;
      case "yes_no":
        if (typeof value !== "boolean") return fieldError(field, "Yes or no is needed");
        break;
    }
    inputs[field.name] = value;
  }
  return { ok: true, inputs };
}
