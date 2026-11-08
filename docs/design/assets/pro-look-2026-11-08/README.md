# PRO-LOOK-01 reference set (2026-11-08)

These pictures are what the build must match. They are HTML mockups drawn with the kit's own icon set and generated cover art,
not output of the image model (see `docs/design/PRO-LOOK-01.md` section 12). Names in them are personas and invented outlets only.

- `img/`: the pictures, JPEG, phones at 2x of a 402 by 874 screen, desktops at 1440 by 900.
- `build.py` and `icons.json`: the generator. `render.sh` runs it and renders PNGs into `html/` and `png/` (both git-ignored).
- `audit/`: the four code audits the build map is based on (frontend, kit, themes, backend and process).

Rule-change parts: some pictures draw options that RULES.md does not allow yet. A slice builds the pictures only as far as RULES.md allows and
builds these parts only after the rule edit (full table in the build map section 1a): the labelled 80 px rail (every `desktop-*`), the main
apps in the phone's floating bar (the `phone-*` pictures that show Home, Chat, Media, Library, Search), large titles below the header row,
hero art behind the header row, and the Activity page, the jobs list, the queue stack, the Activity entry and its dot (`making-now-queue`,
`desktop-status-stack`, `phone-status-stack`, `phone-drawer-activity`, `activity-indicator`).

How to use a picture: the slice named below opens it next to the running dev hub at the same size, in light and dark and in two Looks,
reads the numbers it shows (title size, row height 76, thumbnail 64, card radius 20, rail width) and asserts them in a test.
Procedure: `docs/design/PRO-LOOK-01-BUILD-MAP.md` section 3.

| Picture | Note section | Slice |
|---|---|---|
| `desktop-home`, `phone-home`, `before-after` | 4, 6, 7 | HOME-01, TOKENS-01 |
| `phone-detail`, `desktop-detail` | 7, 9 | MEDIA-01 |
| `phone-library` | 9 | LIBRARY-01 |
| `desktop-chat` | 9 | CHAT-01 |
| `phone-news`, `phone-news-reader`, `phone-wiki`, `phone-videos`, `phone-video-watch` | 17 | NEWS-01, MEDIA-01 |
| `desktop-video-create`, `phone-video-create`, `desktop-music-create`, `phone-music-create`, `desktop-photo-edit` | 9a, 18 | STUDIOS-01 |
| `phone-apps`, `phone-drawer` | 16, 23 | APPS-01, NAV-01 |
| `phone-drawer-activity`, `activity-indicator` (option i) | 25 | ACTIVITY-01 only |
| `making-now`, `downloads-card`, `status-cards`, `phone-notifications` | 20 to 22 | JOB-01, ERRORS-01 |
| `making-now-queue`, `desktop-status-stack`, `phone-status-stack` (option i previews) | 20, 21 | ACTIVITY-01 only |
| `phone-news-job`, `desktop-news-job` | 23 | JOB-01 |
| `desktop-settings`, `phone-settings`, `desktop-family` | 9 | SETTINGS-01 |
| `phone-weather`, `phone-reminders`, `desktop-signin`, `phone-signin`, `desktop-setup` | 9 | REST-01 |
| `themes` | 24 | TOKENS-01 |
