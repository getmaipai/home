# Reference reader and library settings

Accepted 2026-10-15 (owner's ruling, question wizard: native reader on kit parts; library first). Owner-approved: 2026-10-15.

Two things the knowledge-sources work always deferred: a reader a person can open the way they open the Wikipedia app, and a
Settings page where an admin picks which sets are installed. Both sit on the shipped sidecar (`kiwixSidecar.ts`,
`referenceLibrary.ts`, `retrieval/referenceReader.ts`) and move to the Stack with KS-STACK-REF-01 behind the same interface.

## The reader

- A Home app page, "Reference", in the shell. Library home (the books the person's age band may read, with size and snapshot
  date), a search box with type-ahead, the article view, back and forward, a table of contents, light and dark, and the licence
  and snapshot line under every article. Kit parts and shipped shell pieces only (rules 9, 9b); no Home wrapper around an Element.
- Home never serves the library's raw HTML. A server-side extractor turns `/content` HTML into a closed block list (heading,
  paragraph, list, definition rows, table of plain cells, figure). Anything else is dropped. Links inside an article are rewritten
  to the reader's own route; a link to a book that is not installed or not on the person's list renders as plain text. A child's
  article keeps zero outbound links (MINOR-SEARCH-01h, 01o). Figures show only when `reference.images` allows them for that person
  and are fetched through a same-origin route.
- Every route goes through the same closed per-band list and minor floor as lookup (`referenceSources.ts`, `minorFloor.ts`).
  A book or article off the list is a 404 with the same plain sentence the cited page already uses.
- Citations: the sources control under a chat answer opens the reader at that article (REFERENCE-CITE-01 folds in).
- Phone first: the layout works at 390 px; the table of contents is a sheet there.

## Library settings

- Settings, Reference library (admin only; a child or teen cannot reach it), declared as data and drawn by `SettingsShell`.
- Shows every set the catalogue offers with installed state, real size, snapshot date and what removing it frees. Each set has
  one action: Install (impact shown first, refused under the 20 percent free-disk margin) or Remove (confirm shows the space
  freed and which age bands lose it). Progress, pause, resume and cancel for a download. The presets (KS-REF-00) are shortcuts
  that select a bundle; Custom is the same list edited by hand.
- A removal is real: the ZIM file is deleted and the sidecar library is reloaded; a person's open reader tab degrades to the
  plain "not available" page. Nothing is ever deleted that this page did not install.

## Reuse check (principle 6)

| Option | Verdict |
|---|---|
| kiwix-serve's own viewer and `/viewer` page | Rejected as the reader. It serves the book's raw HTML, so a child's page would carry outbound links and unsanitised markup, it ignores the per-band list and minor floor, and it cannot take Home's tokens. Kept as the content source only. |
| A maintained HTML sanitizer (sanitize-html, DOMPurify) | Rejected. It returns cleaned HTML, which still has to be drawn with raw markup. Home needs a closed block list drawn by kit parts, which a sanitizer does not produce. The parser we already ship (`linkedom`, used by `retrieval/extractArticle.ts`) does the walk; no new dependency. |
| The kit's shipped parts (blocks, Table, Sheet, Command, search) | Used for everything drawn: headings, lists, tables, the table-of-contents sheet, the type-ahead. Nothing is rebuilt. |
| `retrieval/extractArticle.ts` | Extended, not duplicated: the lead-and-infobox extractor stays; the full-article block extractor is a sibling in the same folder. |

## Rules this work must also keep

- S4 and S5 (settings are data, drawn by `SettingsShell`; the Reference library page declares no layout of its own).
- Rule 6a: reader search and suggest log no query text and nothing person-identifying.
- Rule 7: a child's article text passes the same fetched-text cleaning as lookup before it is shown.

## Supersedes

- The `REFERENCE-APP-01` placeholder in `docs/dev.md` (the "full Reference app" Library screen), now this plan.
- KS-REF-WIZARD-01's Settings half: it becomes REFERENCE-SETTINGS-01 below and ships ahead of the wizard step. The wizard step
  stays with the setup plan.
