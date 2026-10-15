# Folder picker on "Choose Home's file folder" (WIZ-STORAGE)

Filed 2026-10-15, Jesse. Status: design, awaiting the architect verdict before any lane starts.

## Ruling

The `storage` screen of the setup wizard lets the owner pick folders, not just read a default:

- **Single computer** (`engines.stack.where` is this computer): two pickers, the AI models folder and Home's own data folder.
- **Split setup** (the engine runs on another computer): one picker, Home's data folder. The models folder belongs to the engine computer and is chosen there.

Jesse chose the full chain on 2026-10-15: the picker, the saved choice, and Home really starting from the chosen folders after a restart.

## What exists today

- The screen is read only: `Home uses its ready-to-use default folder` (`SetupWizard.tsx`, `renderSetupReviewScreen`).
- `POST /api/setup/storage` records the step done and stores nothing else.
- `lib/placement.ts` `checkPlacement(layout)` already returns plain-sentence refusals and warnings per class; `@maipai/core` v0.1.5 has `diskFacts`, the probes, the folder marker and the location record; the spec has the location-record and marker shapes (spec-v0.1.58 and later).
- `lib/paths.ts` resolves a class folder from `MAIPAI_DATA_DIR` or the default; nothing reads a location record at boot yet (DATA-LOCATION-01a).
- The kit has no folder-picker part.

## Design

1. **Kit part (commons `ui`, additive).** A `FolderPicker` primitive: breadcrumb path, list of subfolders, an "Up" action, a "Choose this folder" action, a "New folder" action, disabled rows with a reason. It owns no data: it takes a listing, handlers and copy. Home passes data and copy, never wraps it (rule 9).
2. **Listing and check endpoints (Home, backend).**
   - `GET /api/setup/folders?path=` lists subfolders, free space and writability of the machine Home runs on. Before the owner exists it answers loopback requests only (same rule as the other pre-owner setup steps, SETUP-LOCAL-ONLY-01); after, owner only. It lists directories only, never file names, hides dot-folders and system roots by default, resolves symlinks before answering, and refuses once setup is complete.
   - `POST /api/setup/storage/check` runs `checkPlacement` on the proposed layout and returns the rows unchanged.
   - `POST /api/setup/folders` creates one new folder under a listed folder, name validated, never outside the listed parent.
3. **Saved choice.** The `storage` step stores a location record (the existing spec shape): `models` and `records`, plus the classes that move with `records` by default. One definition: the same record the installers (01c) and Settings > Storage (02a) read.
4. **Startup from the record (DATA-LOCATION-01a).** `bootGuard` resolves each class from `MAIPAI_DATA_DIR`, then the record, then the default; marker checks and refusal rules per the design record. After the screen saves, the wizard tells the owner Home will restart, runs the restart, and resumes at the next step; the hub never moves existing data in this path because setup runs on an empty folder (a folder that already holds a household is adopted, never overwritten).
5. **Split setup.** The models picker is absent; the engine link carries the engine computer's own folder choice (the Stack's setting, DATA-LOCATION-01c's `--location` for the engine installer) and the checks screen reads its disk facts through the engine link.

## Order (one lane each, serial where a tag is needed)

| Id | Lane | Repo | Needs |
|---|---|---|---|
| WIZ-STORAGE-01 | `FolderPicker` kit part, tagged | commons | none |
| WIZ-STORAGE-02 | listing, new-folder and check endpoints with tests | home | none |
| DATA-LOCATION-01a | boot from the record | home | none (already filed) |
| DATA-LOCATION-01b | hold mode and restart loop (a restart at setup must survive an exit 75) | home | 01a |
| WIZ-STORAGE-03 | the screen: pickers, single vs split, save, restart and resume | home | 01, 02, 01a, 01b |
| WIZ-STORAGE-04 | split setup: engine computer's folder through the engine link | home + stack | 03 |

01d, 01e and the rest of the DATA-LOCATION list stay as filed; none blocks the picker.

## Out of scope

Moving data that already exists (DATA-LOCATION-02b to 02d), the installer flags (01c), Settings > Storage (02a).

## Acceptance (for the whole item)

On a fresh machine: pick a folder on a second disk for models and another for Home's data, continue, see Home restart, and find `hub.db` and the model downloads in the chosen folders and nothing new in the default one. A read-only folder, a folder inside the app's own code, a full disk and a path that vanishes mid-pick each show a plain sentence saying what went wrong and what to do. On a split setup only the data folder is asked. Screenshots of every state are opened and judged at desktop and phone width.
