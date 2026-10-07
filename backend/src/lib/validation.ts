// The displayName and secret bounds were copy-pasted verbatim between
// routes/auth.ts and routes/people.ts (found by a code review,
// 2026-09-04: two independent angles hit this). One definition here
// instead, per CLAUDE.md principle 4.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MIN_SECRET_LENGTH = 4;

export function validateDisplayName(value: unknown): ValidationResult<string> {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 80) {
    return { ok: false, error: "displayName is required (1-80 characters)" };
  }
  return { ok: true, value: trimmed };
}

export function validateSecret(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH || value.length > 128) {
    return { ok: false, error: `secret must be ${MIN_SECRET_LENGTH}-128 characters` };
  }
  return { ok: true, value };
}
