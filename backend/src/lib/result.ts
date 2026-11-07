// AUDIT-DUP-ROUTES-01: the one success-or-refusal shape every lib operation returns to a route. `status` is the HTTP status the
// route answers with when the operation refuses; `S` narrows it to the statuses that operation can produce. Libs name their own
// aliases (`type FolderOpResult<T> = Result<T, 400 | 403 | 404>`) but declare the shape nowhere else.
export type Result<T, S extends number = 400 | 403 | 404> = { ok: true; value: T } | { ok: false; status: S; error: string };
