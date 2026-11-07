// AUDIT-DUP-ROUTES-01: the one success-or-refusal shape every lib operation returns to a route. `status` is the HTTP status the
// route answers with when the operation refuses; `S` narrows it to the statuses that operation can produce. Libs name their own
// aliases (`type FolderOpResult<T> = Result<T, 400 | 403 | 404>`) but declare the shape nowhere else.
export type Result<T, S extends number = 400 | 403 | 404> = { ok: true; value: T } | { ok: false; status: S; error: string };

/** The statuses an edit route passes through from a lib refusal (not found, forbidden, conflict); anything else is a plain 400. */
export function conflictStatus(status: number | undefined): 400 | 403 | 404 | 409 {
  return status === 404 || status === 403 || status === 409 ? status : 400;
}
