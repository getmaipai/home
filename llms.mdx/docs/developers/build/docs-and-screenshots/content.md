# Write docs and screenshots (/docs/developers/build/docs-and-screenshots)

## Declare what a page covers [#declare-what-a-page-covers]

Every page under `content/docs` and every key in `screenshots.json` has an entry in `docs/site-fumadocs/docs-covers.json`:

```json
"user/everyday-use/use-incognito": { "areas": ["incognito"] }
```

- `areas` names code groups defined once at the top of the file, each a list of globs.
- `covers` adds extra globs for one page (for example `docs/design/RULES.md`).
- `ignore` lists globs that never count as a change: tests, locales, docs.
- `baseline` is the commit the docs were last verified at, used until a `v*` tag exists.

## Check what changed [#check-what-changed]

```bash
bun scripts/docsDrift.ts
```

It lists the pages to re-check and the pictures to retake since the last release tag. `--since <ref>` picks another start, `--json` gives machine output, `--check` fails if a page or picture has no entry.

## Screenshots [#screenshots]

Pictures come only from the screenshot script. The drift output prints the `DOCS_SHOTS_ONLY=...` line that retakes just the affected docs pictures. A picture whose file does not start with `docs-` comes from the general screenshot run. Open every retaken picture before using it.

## Kept current by [#kept-current-by]

[Keeping the docs current](/docs/keeping-docs-current) explains the release step. The test `scripts/docsDrift.test.ts` fails if the map falls out of step with the pages.
