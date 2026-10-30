# The reference reader (READER-00 to READER-13)

One reader draws every Kiwix article: the Wikipedia app and the Reference page both use `frontend/src/shell/reader/`. Design record: `docs/design/kiwix-reader-2026-10-29.md`.

- **Backend.** `backend/src/routes/reference.ts` is the only route file; article loading and the response shape live in `backend/src/lib/reference/article.ts`; all kiwix-serve calls go through `backend/src/lib/kiwixClient.ts`. Routes: `/article`, `/preview`, `/random`, `/search` (adults skip the per-hit fetch; minors keep the full-text floor, four fetches at a time), `/media`, and `/saves` (list, save, remove). The age floor, closed book list, link rule (adults only) and the `reference.images` setting apply to every route and to the offline provider.
- **Saved articles.** Spec record `ReferenceSave` (`spec-v0.1.276`), table `reference_saves`, unique on person, book and path. A save whose book the person may no longer read is hidden from the list, not deleted. The title always comes from the server.
- **Keep on this device.** Offline provider kind `reference` (`backend/src/lib/offline/reference.ts`), record id `<book>~<path>`. The manifest has one article entry (the payload with picture addresses rewritten to offline entries) and one entry per picture. Fingerprints are SHA-256 of the bytes, so an unchanged article reconciles cleanly. The client is the existing `keepOnDevice`; `frontend/src/shell/reader/offline.ts` reads a kept article from the cache when the hub does not answer.
- **Kit.** `ArticleView` in commons draws the article, the facts column, Contents, Related, link previews and the Save action. Reader changes that need a new look go to commons first (rule 9).
- **Preview.** `bun run dev`, then point the hub at a Kiwix with `MAIPAI_KIWIX_PORT`. `backend/tests/support/fakeKiwix.ts` is a small fake library for tests.
- **Not built.** Listen and Share (no speech route for reference text yet).
