// AUDIT-DUP-ROUTES-01: the one success-or-refusal shape every lib operation returns to a route. `status` is the HTTP status the
// route answers with when the operation refuses; `S` narrows it to the statuses that operation can produce. Libs name their own
// aliases (`type FolderOpResult<T> = Result<T, 400 | 403 | 404>`) but declare the shape nowhere else.
//
// I18N-B2b: a refusal a person reads carries a stable `code` next to its English `error`. The words live only in the table
// (lib/apiErrorCopy.ts); a lib function builds the refusal with `refusal(status, code)`, and `refuseWith` / `refusalBody` send it as
// `apiError(code)`. A refusal without a code is developer text (a validation join, a dynamic message) and goes out as `{ error }`.
import { API_ERROR_LINES, apiError, type ApiErrorBodyCode } from "@/lib/apiErrorCopy";

/** A lib `code` that is not a table code (a route-local code such as "temporary_mismatch") is not sent through the table. */
function isTableCode(code: string): code is ApiErrorBodyCode {
  return Object.hasOwn(API_ERROR_LINES, code) && "error" in (API_ERROR_LINES as Record<string, object>)[code]!;
}

export type Result<T, S extends number = 400 | 403 | 404> = { ok: true; value: T } | { ok: false; status: S; error: string; code?: string };

/** A coded refusal: the status, the table's English as `error`, and the `code`. */
export function refusal<S extends number>(status: S, code: ApiErrorBodyCode): { ok: false; status: S; error: string; code: ApiErrorBodyCode } {
  return { ok: false, status, error: apiError(code).error, code };
}

/** The response body for a lib refusal: the coded body (`error`, `code`, `next`) when it has a code, else the bare `{ error }`. */
export function refusalBody(failure: { error?: string; code?: string }, fallback = "Request failed"): { error: string; code?: string; next?: string } {
  return failure.code && isTableCode(failure.code) ? apiError(failure.code) : { error: failure.error ?? fallback };
}

/** The statuses an edit route passes through from a lib refusal (not found, forbidden, conflict); anything else is a plain 400. */
export function conflictStatus(status: number | undefined): 400 | 403 | 404 | 409 {
  return status === 404 || status === 403 || status === 409 ? status : 400;
}
