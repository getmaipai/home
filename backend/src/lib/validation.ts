// The displayName and secret bounds were copy-pasted verbatim between
// routes/auth.ts and routes/people.ts (found by a code review,
// 2026-09-04: two independent angles hit this). One definition here
// instead, per CLAUDE.md principle 4.

// I18N-B2b: a refusal names a table code (lib/apiErrorCopy.ts); the words live only there.
import { apiError, type ApiErrorBodyCode } from "@/lib/apiErrorCopy";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string; code: ApiErrorBodyCode };

function invalid(code: ApiErrorBodyCode): { ok: false; error: string; code: ApiErrorBodyCode } {
  return { ok: false, error: apiError(code).error, code };
}

export function validateDisplayName(value: unknown): ValidationResult<string> {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 80) {
    return invalid("display_name_length");
  }
  return { ok: true, value: trimmed };
}

export function validateSecret(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || value.length < 4 || value.length > 128) {
    return invalid("secret_length");
  }
  return { ok: true, value };
}

/** AUDIT-DUP-ROUTES-01: a request's JSON body as a plain object; anything else (bad JSON, an array, a string) is `{}`. One definition for the media routes. */
export async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
