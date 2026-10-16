# REFERENCE-READER-01a report

## Routes

- `GET /api/reference/books`: installed books readable by the signed-in person's age band, with source, language, bytes, snapshot date, licence and available article count.
- `GET /api/reference/suggest?book=&q=`: up to 10 title suggestions for a readable installed book.
- `GET /api/reference/search?q=&book=`: up to 20 full-text hits with title, snippet, book and path. Each hit's snippet and extracted article text pass the minor floor.
- `GET /api/reference/article/{book}/{path}`: closed JSON article model, guarded by the same installed book and age-band list; redirects point to this route.
- `GET /api/reference/media/{book}/{path}`: same-list and `reference.images` gated media, png/jpeg/webp/svg only, with `nosniff`, same-origin resource policy and CSP sandbox.

The existing `GET /api/reference/{book}/{path}` cited-page behavior remains unchanged. An unavailable or disallowed article returns its existing plain-text 404 sentence.

## Block schema

`Block` is a union of `heading(level 2..4, id, text)`, `paragraph(inlines)`, `list(ordered, items of inlines)`, `rows(label/value pairs)`, `table(headers, plain-text rows)`, `figure(src, alt, caption)`, and `note(text)`. Inline values are text, emphasis, strong, or link(text, optional installed reader target). Children receive no link targets and no figures. Hostile elements and unsafe URLs are discarded.

## Verification

- `backend/tests/referenceReaderRoutes.test.ts`, `referenceRoute.test.ts`, and `retrievalReferenceReader.test.ts`: 39 tests passed.
- `cd backend && bunx tsc --noEmit`: passed.
- `cd backend && bun run gen:api-docs`: regenerated `docs/api/openapi.json` with 239 paths.
- `MAIPAI_COMMONS_DIR=/Users/jessetorres/Developer/github.com/getmaipai/commons bash scripts/check.sh`: passed on the final full gate run. The preceding full run hit an unrelated backend conversation persistence failure; the rerun passed.

## Unfinished

None known. The full repository gate is pending.
