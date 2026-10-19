# The Library page (frontend)

Built 2026-10-19 for LIBRARY-REVAMP-07, -08 and -09. The route is `/files`; `FilesPage.tsx` holds the state and layout, and
`frontend/src/shell/library/` holds the parts. The design is [library-2026-10-18.md](../design/library-2026-10-18.md); the backend is
[library-storage.md](library-storage.md).

## State lives in the address

`libraryModel.ts` parses and writes the query string: `section` (all, pictures, videos, songs, documents, shared-with-me, shared-by-me,
only-me, trash), `filter=mine`, `q`, `sort` (newest, oldest, name, size; `new` from Home's shelf means newest), `view=list` and
`file=<id>`. Defaults are left out. A section and filter become the listing's `type`, `shared` and `owner=me`; the hub does all
filtering and paging (60 per page, cursor). Counts come from `/api/library/summary` (one call per section group), the header from
the summary of the current filters, and the storage meter from the caller's own row of `/api/storage/usage`.

## Parts and the kit

- Column: the kit `SectionSidebar` (`standalone`, compact, `collapsedStyle="hidden"`, Settings as `footer`, the storage meter as
  `footerSlot`). Collapsed state is per person in `localStorage` (`librarySidebarPreference.ts`), like the Chat column.
- Phone: below `lg` a button row of the same sections (48 px targets) and a search box; the same groups go to the menu drawer through
  `useDrawerSections` (`drawerSections.tsx`, provided by `Routes.tsx` as `FullLayout`'s `mobileSections`).
- Items: `FileGrid` (menu through `wrapActions`) or `DataTable` (header sorting maps to the hub's sort; the menu is in the last cell
  because the table's header draws no actions cell). Viewer: `MediaViewer`. Sharing: `ShareDialog`. Uploads: `JobProgress` cards.
- Rule 9: no `className` on an Element that changes its look, and no component whose root is an Element with a box around it. The
  parts that render an Element return it inside a fragment as a use site that maps data to it (`lint:ui-rules` passes with no baseline change).

## Who sees what

The page never relies on hiding. A child gets no Share, Send, Shared by me or Upload (it shows "Ask to add a file"); a teen or child
never receives an adults-only item from the hub; Mark all-ages is offered only to an adult owner and the hub checks again. Every
change (trash, keep, rename, share) goes to a route that checks the caller; a batch skips files the person does not own and reports why.

## Uploads

`frontend/src/lib/libraryUpload.ts`: a file up to 100 MB goes as one multipart request (XHR, for byte progress); a bigger one uses the
chunk sessions (8 MB at a time, up to 500 MB). Up to three run at once. A refusal shows the hub's sentence with Try again.

## Measuring

`bun run screenshots --library-review` seeds a scratch household (`backend/scripts/seed-library-review.ts`) and captures the owner, a
teen and a child at 1440 and 390 under `data-scratch/library-review/`; `LIBRARY_REVIEW_BULK=<n>` seeds that many extra pictures and
measures scrolling instead. `--a11y-only` and `--files-review` use the same seed.
